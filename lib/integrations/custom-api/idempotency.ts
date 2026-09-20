import crypto from 'crypto'

/**
 * Hash du payload : détecte la réutilisation d'une clé d'idempotence
 * avec un contenu différent.
 * L'enregistrement de l'idempotence est réalisé de façon atomique par la RPC
 * `rpc_ingest_public_order` (migration 20260921_rpc_ingest_public_order.sql).
 */
export function computePayloadHash(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

