/**
 * Dictée vocale de l'assistant : audio → texte, sans conservation.
 *
 * Sécurité :
 * - mêmes verrous que le chat (origine, verrou global, allowlist Supabase Auth,
 *   permission `ai_assistant.use`, appartenance à la boutique) ;
 * - clé OpenAI exclusivement côté serveur ;
 * - audio uniquement en mémoire, jamais écrit sur disque ni dans Supabase ;
 * - plafond de taille, de durée, de fréquence et de coût quotidien.
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
import {
  claimTranscriptionRequest,
  completeTranscriptionRequest,
  failTranscriptionRequest,
  reserveTranscriptionBudget,
} from '@/lib/assistant/transcription-budget'
import {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
  MIN_AUDIO_BYTES,
  TRANSCRIPTION_MODEL,
  baseAudioType,
  buildTranscriptionPrompt,
  isSupportedAudioType,
  isTranscriptionEnabled,
} from '@/lib/assistant/transcription-limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions'
const UPSTREAM_TIMEOUT_MS = 25_000
/** Marge multipart au-dessus de la limite audio. */
const MAX_BODY_BYTES = MAX_AUDIO_BYTES + 128 * 1024

function readSeconds(raw: FormDataEntryValue | null): number {
  const milliseconds = Number(raw ?? 0)
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 0
  return Math.round(milliseconds / 1000)
}

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    assertAssistantEnabled()

    // Fermée par défaut : le quota n'est pas global tant qu'aucun compteur
    // partagé atomique n'est en place. Aucun appel fournisseur n'est possible ici.
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
    if (typeof audio.size !== 'number' || audio.size < MIN_AUDIO_BYTES) {
      throw new Error('TRANSCRIPTION_AUDIO_EMPTY')
    }
    if (audio.size > MAX_AUDIO_BYTES) throw new Error('TRANSCRIPTION_TOO_LARGE')
    if (!isSupportedAudioType(audio.type)) throw new Error('TRANSCRIPTION_UNSUPPORTED_TYPE')

    const storeId = String(form.get('storeId') || '').trim()
    if (!storeId) throw new Error('INVALID_STORE_ID')
    // Permission d'usage + appartenance active : aucune donnée financière n'est
    // lue ici, le niveau `full` n'est donc pas exigé.
    await requireAssistantPermission(supabase, user.id, storeId)

    const requestId = String(form.get('requestId') || '').trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
      throw new Error('INVALID_REQUEST')
    }

    // Idempotence : une même tentative ne paie jamais deux fois.
    const claim = claimTranscriptionRequest(user.id, requestId)
    if (claim.status === 'pending') throw new Error('TRANSCRIPTION_IN_PROGRESS')
    if (claim.status === 'done') {
      return NextResponse.json({ text: claim.text, replayed: true })
    }

    try {
      const reportedSeconds = readSeconds(form.get('durationMs'))
      if (reportedSeconds <= 0) throw new Error('TRANSCRIPTION_DURATION_MISSING')
      if (reportedSeconds > MAX_AUDIO_SECONDS + 1) throw new Error('TRANSCRIPTION_TOO_LONG')

      // Durée plafonnée et **jamais sous-estimée** : la valeur client est
      // confrontée à une estimation basse depuis la taille (≈16 kbit/s), afin
      // qu'une durée minimisée ne contourne pas le plafond de coût.
      const estimatedSeconds = Math.ceil(audio.size / 2_000)
      const billedSeconds = Math.min(
        Math.max(reportedSeconds, estimatedSeconds, 1),
        MAX_AUDIO_SECONDS,
      )

      const budget = reserveTranscriptionBudget(user.id, billedSeconds)
      if (!budget.ok) throw new Error(budget.code)

      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) throw new Error('TRANSCRIPTION_NOT_CONFIGURED')

      const upstream = new FormData()
      upstream.append('file', audio, `dictation.${baseAudioType(audio.type).split('/')[1] || 'webm'}`)
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

        // Texte payé mémorisé : un doublon renvoie ce texte sans nouvel appel.
        completeTranscriptionRequest(user.id, requestId, text)
        console.info('[assistant] transcription_ok', { storeId, durationSeconds: billedSeconds })
        return NextResponse.json({ text })
      } finally {
        clearTimeout(timer)
        request.signal.removeEventListener('abort', forwardAbort)
      }
    } catch (error) {
      // Aucun texte exploitable : la tentative est libérée pour un nouvel essai.
      failTranscriptionRequest(user.id, requestId)
      throw error
    }
  } catch (error) {
    const aborted = error instanceof Error && (error.name === 'AbortError' || error.message === 'TRANSCRIPTION_TIMEOUT')
    const safeError = aborted ? new Error('TRANSCRIPTION_TIMEOUT') : error
    const publicError = toPublicError(safeError)
    return NextResponse.json(
      { error: publicError.code, message: publicError.message },
      { status: publicError.status },
    )
  }
}
