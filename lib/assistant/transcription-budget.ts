/**
 * Réservation atomique et partagée du budget de dictée.
 *
 * Source de vérité : un RPC PostgreSQL (`rpc_assistant_reserve_transcription`)
 * qui verrouille la ligne utilisateur/jour avant tout appel fournisseur.
 *
 * Échec fermé : sans ce RPC (migration non appliquée), sans utilisateur
 * authentifié ou en cas d'erreur, la réservation renvoie `unavailable` et
 * la route refuse la transcription. Aucun quota mémoire local n'est présenté
 * comme une garantie globale.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  TRANSCRIPTION_DAILY_REQUESTS,
  TRANSCRIPTION_DAILY_SECONDS,
} from '@/lib/assistant/transcription-limits'

export const TRANSCRIPTION_RESERVE_RPC = 'rpc_assistant_reserve_transcription'

export type TranscriptionReservation =
  | { status: 'reserved'; secondsUsed: number }
  | { status: 'duplicate' }
  | { status: 'daily_limit' }
  | { status: 'unavailable' }

interface ReserveRow {
  outcome?: unknown
  seconds_used?: unknown
}

/**
 * Réserve la durée réelle (déjà validée côté serveur) avant l'appel fournisseur.
 * Un même `requestId` ne peut jamais être facturé deux fois.
 */
export async function reserveTranscriptionSlot(
  supabase: SupabaseClient,
  input: { requestId: string; seconds: number },
): Promise<TranscriptionReservation> {
  const seconds = Math.ceil(input.seconds)
  if (!Number.isFinite(seconds) || seconds < 1) return { status: 'unavailable' }

  const { data, error } = await supabase.rpc(TRANSCRIPTION_RESERVE_RPC, {
    p_request_id: input.requestId,
    p_seconds: seconds,
    p_max_seconds: TRANSCRIPTION_DAILY_SECONDS,
    p_max_requests: TRANSCRIPTION_DAILY_REQUESTS,
  })

  if (error) return { status: 'unavailable' }

  const row = (Array.isArray(data) ? data[0] : data) as ReserveRow | null
  const outcome = typeof row?.outcome === 'string' ? row.outcome : ''

  if (outcome === 'reserved') {
    const used = Number(row?.seconds_used)
    return { status: 'reserved', secondsUsed: Number.isFinite(used) ? used : seconds }
  }
  if (outcome === 'duplicate') return { status: 'duplicate' }
  if (outcome === 'daily_limit') return { status: 'daily_limit' }

  // Réponse inattendue : jamais de repli permissif.
  return { status: 'unavailable' }
}
