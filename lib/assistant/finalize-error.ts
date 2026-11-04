/**
 * Traduction des refus de la RPC de finalisation.
 *
 * `rpc_assistant_finalize_request` refuse avec `RAISE ... USING errcode = 'P0001'` :
 * le SQLSTATE est toujours identique, seule la **description** distingue la cause
 * (double envoi, bail perdu, conflit, accès boutique, contenu invalide).
 *
 * Ce module est volontairement sans dépendance : il est testable sans base.
 */
export const FINALIZE_RPC_CODES: ReadonlySet<string> = new Set([
  'IDEMPOTENCY_CONFLICT',
  'IDEMPOTENCY_IN_PROGRESS',
  'IDEMPOTENCY_LEASE_LOST',
  'IDEMPOTENCY_TOKEN_MISMATCH',
  'IDEMPOTENCY_REPLAY_UNAVAILABLE',
  'FORBIDDEN_STORE',
  'THREAD_STORE_MISMATCH',
  'INVALID_REQUEST',
  'INVALID_FINGERPRINT',
  'INVALID_MESSAGE_CONTENT',
  'INVALID_METADATA',
])

/**
 * Une cause connue est conservée telle quelle ; toute autre erreur retombe sur
 * `FINALIZE_RPC_FAILED`. Rien n'est inventé ni masqué en silence.
 */
export function toFinalizeError(rawMessage: string): Error {
  const code = String(rawMessage ?? '').trim()
  return new Error(FINALIZE_RPC_CODES.has(code) ? code : 'FINALIZE_RPC_FAILED')
}
