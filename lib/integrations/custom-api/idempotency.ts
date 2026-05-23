import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

export function computePayloadHash(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

/**
 * Vérifie et enregistre l'idempotence.
 * Retourne { isDuplicate, existingOrderId } si déjà traité.
 */
export async function checkIdempotency(params: {
  storeId: string
  apiKeyId: string | null
  idempotencyKey: string
  payloadHash: string
}): Promise<{ isDuplicate: boolean; existingOrderId: string | null }> {
  const supabase = createAdminClient()

  const { data: existing } = await supabase
    .from('public_order_idempotency')
    .select('order_id')
    .eq('store_id', params.storeId)
    .eq('idempotency_key', params.idempotencyKey)
    .maybeSingle()

  if (existing) {
    return { isDuplicate: true, existingOrderId: existing.order_id }
  }

  return { isDuplicate: false, existingOrderId: null }
}

export async function recordIdempotency(params: {
  storeId: string
  apiKeyId: string | null
  idempotencyKey: string
  payloadHash: string
  orderId: string
}): Promise<void> {
  const supabase = createAdminClient()

  await supabase.from('public_order_idempotency').insert({
    store_id: params.storeId,
    api_key_id: params.apiKeyId,
    idempotency_key: params.idempotencyKey,
    payload_hash: params.payloadHash,
    order_id: params.orderId,
  })
}
