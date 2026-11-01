/**
 * Dictée vocale de l'assistant : WAV → texte, sans conservation.
 *
 * Sécurité :
 * - mêmes verrous que le chat (origine, verrou global, allowlist Supabase Auth,
 *   permission `ai_assistant.use`, appartenance à la boutique) ;
 * - clé OpenAI exclusivement côté serveur ;
 * - audio uniquement en mémoire, jamais écrit sur disque ni dans Supabase ;
 * - durée recalculée depuis l'en-tête WAV : la valeur du navigateur n'est pas lue ;
 * - budget journalier réservé de façon atomique en base AVANT l'appel
 *   fournisseur, avec échec fermé si la réservation est indisponible ;
 * - anti-rejeu : un même `requestId` ne peut pas être facturé deux fois.
 *
 * Aucun débit de crédits IA ici : le coût de transcription reste séparé du
 * portefeuille de chat dans cette version.
 */
import { NextResponse } from 'next/server'
import { assertAssistantAccess, assertAssistantEnabled } from '@/lib/assistant/access'
import {
  requireAuthenticatedUser,
  requireAssistantPermission,
  assertTrustedOrigin,
  toPublicError,
} from '@/lib/assistant/security'
import { reserveTranscriptionSlot } from '@/lib/assistant/transcription-budget'
import { validateWavForTranscription } from '@/lib/assistant/audio-wav'
import {
  MAX_AUDIO_BYTES,
  TRANSCRIPTION_MODEL,
  buildTranscriptionPrompt,
  isTranscriptionEnabled,
} from '@/lib/assistant/transcription-limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions'
const UPSTREAM_TIMEOUT_MS = 25_000
/** Marge multipart au-dessus de la limite audio. */
const MAX_BODY_BYTES = MAX_AUDIO_BYTES + 128 * 1024

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    assertAssistantEnabled()

    // Fermée par défaut : le quota n'est garanti que par le RPC partagé.
    if (!isTranscriptionEnabled()) throw new Error('TRANSCRIPTION_NOT_CONFIGURED')

    const { supabase, user } = await requireAuthenticatedUser()
    // Allowlist vérifiée avant toute lecture, tout appel fournisseur et tout coût.
    assertAssistantAccess(user.id)

    const contentLength = Number(request.headers.get('content-length') || 0)
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      throw new Error('TRANSCRIPTION_TOO_LARGE')
    }

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      throw new Error('INVALID_REQUEST')
    }

    const file = form.get('file')
    if (!file || typeof file === 'string') throw new Error('TRANSCRIPTION_AUDIO_EMPTY')

    const audio = file as Blob
    if (typeof audio.size !== 'number' || audio.size <= 0) {
      throw new Error('TRANSCRIPTION_AUDIO_EMPTY')
    }
    if (audio.size > MAX_AUDIO_BYTES) throw new Error('TRANSCRIPTION_TOO_LARGE')

    const storeId = String(form.get('storeId') || '').trim()
    if (!storeId) throw new Error('INVALID_STORE_ID')
    // Permission d'usage + appartenance active : aucune donnée financière n'est
    // lue ici, le niveau `full` n'est donc pas exigé.
    await requireAssistantPermission(supabase, user.id, storeId)

    const requestId = String(form.get('requestId') || '').trim()
    if (!UUID_PATTERN.test(requestId)) throw new Error('INVALID_REQUEST')

    // Durée réelle : lecture stricte de l'en-tête WAV, jamais du client.
    const bytes = new Uint8Array(await audio.arrayBuffer())
    const validation = validateWavForTranscription(bytes)
    if (!validation.ok) throw new Error(validation.code)
    const seconds = validation.info.durationSeconds

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('TRANSCRIPTION_NOT_CONFIGURED')

    // Réservation atomique en base, AVANT tout appel payant.
    const reservation = await reserveTranscriptionSlot(supabase, { requestId, seconds })
    if (reservation.status === 'duplicate') throw new Error('TRANSCRIPTION_ALREADY_PROCESSED')
    if (reservation.status === 'daily_limit') throw new Error('TRANSCRIPTION_DAILY_LIMIT')
    if (reservation.status === 'unavailable') throw new Error('TRANSCRIPTION_BUDGET_UNAVAILABLE')

    const upstream = new FormData()
    upstream.append('file', audio, 'dictation.wav')
    upstream.append('model', TRANSCRIPTION_MODEL)
    upstream.append('prompt', buildTranscriptionPrompt())

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
    const forwardAbort = () => controller.abort()
    request.signal.addEventListener('abort', forwardAbort, { once: true })

    try {
      const response = await fetch(OPENAI_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: upstream,
        signal: controller.signal,
      })

      if (!response.ok) {
        console.warn('[assistant] transcription_provider_failed', {
          storeId,
          status: response.status,
        })
        throw new Error('TRANSCRIPTION_PROVIDER_FAILED')
      }

      const payload = (await response.json().catch(() => null)) as { text?: unknown } | null
      const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
      if (!text) throw new Error('TRANSCRIPTION_EMPTY_RESULT')

      // La réservation reste consommée : un échec ne rouvre pas de budget.
      console.info('[assistant] transcription_ok', {
        storeId,
        durationSeconds: Math.ceil(seconds),
      })
      return NextResponse.json({
        text,
        durationSeconds: Number(seconds.toFixed(2)),
      })
    } finally {
      clearTimeout(timer)
      request.signal.removeEventListener('abort', forwardAbort)
    }
  } catch (error) {
    const aborted =
      error instanceof Error && (error.name === 'AbortError' || error.message === 'TRANSCRIPTION_TIMEOUT')
    const safeError = aborted ? new Error('TRANSCRIPTION_TIMEOUT') : error
    const publicError = toPublicError(safeError)
    return NextResponse.json(
      { error: publicError.code, message: publicError.message },
      { status: publicError.status },
    )
  }
}
