import { createClient } from '@/lib/supabase/server'
import { computePayloadHash, checkIdempotency, recordIdempotency } from './idempotency'

export type IngestOrderPayload = {
  idempotency_key: string
  external_order_id: string
  customer_name: string
  phone?: string
  city?: string
  address?: string
  total_selling_price: number
  delivery_fee?: number
  delivery_charge_to_customer?: number
  discount_type?: 'fixed' | 'amount' | 'percentage'
  discount_value?: number
  discount_amount?: number
  subtotal_amount?: number
  source?: 'organic' | 'ads' | 'recommendation'
  order_date?: string
  items: Array<{
    product_name: string
    product_sku?: string
    quantity: number
    unit_selling_price: number
  }>
}

export type IngestResult = {
  status: 'accepted' | 'duplicate' | 'rejected'
  orderId: string | null
  errorCode?: string
  errorMessage?: string
}

export async function ingestOrder(
  storeId: string,
  apiKeyId: string | null,
  payload: IngestOrderPayload
): Promise<IngestResult> {
  const supabase = await createClient()
  const payloadHash = computePayloadHash(payload)

  // 1. Vérifier idempotence
  const { isDuplicate, existingOrderId } = await checkIdempotency({
    storeId,
    apiKeyId,
    idempotencyKey: payload.idempotency_key,
    payloadHash,
  })

  if (isDuplicate) {
    await logIngestion(storeId, apiKeyId, payload.external_order_id, 'duplicate', {
      errorCode: 'IDEMPOTENCY_DUPLICATE',
      errorMessage: 'Cette commande a déjà été importée',
      payload,
    })
    return { status: 'duplicate', orderId: existingOrderId }
  }

  // 2. Valider les champs requis
  if (!payload.customer_name?.trim()) {
    await logIngestion(storeId, apiKeyId, payload.external_order_id, 'rejected', {
      errorCode: 'MISSING_CUSTOMER_NAME',
      errorMessage: 'Le nom du client est requis',
      payload,
    })
    return { status: 'rejected', orderId: null, errorCode: 'MISSING_CUSTOMER_NAME', errorMessage: 'Le nom du client est requis' }
  }

  if (!payload.items?.length) {
    await logIngestion(storeId, apiKeyId, payload.external_order_id, 'rejected', {
      errorCode: 'MISSING_ITEMS',
      errorMessage: 'Au moins un article est requis',
      payload,
    })
    return { status: 'rejected', orderId: null, errorCode: 'MISSING_ITEMS', errorMessage: 'Au moins un article est requis' }
  }

  // 3. Créer la commande
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      store_id: storeId,
      external_order_id: payload.external_order_id,
      customer_name: payload.customer_name.trim(),
      phone: payload.phone || null,
      city: payload.city || null,
      address: payload.address || null,
      total_selling_price: payload.total_selling_price,
      delivery_fee: payload.delivery_fee ?? 0,
      delivery_charge_to_customer: payload.delivery_charge_to_customer ?? 0,
      discount_type: payload.discount_type || null,
      discount_value: payload.discount_value ?? 0,
      discount_amount: payload.discount_amount ?? 0,
      subtotal_amount: payload.subtotal_amount ?? 0,
      source: payload.source || 'organic',
      order_date: payload.order_date || new Date().toISOString(),
      status: 'new',
    })
    .select('id')
    .single()

  if (orderError || !order) {
    await logIngestion(storeId, apiKeyId, payload.external_order_id, 'error', {
      errorCode: 'ORDER_INSERT_FAILED',
      errorMessage: orderError?.message || 'Erreur lors de la création de la commande',
      payload,
    })
    return { status: 'rejected', orderId: null, errorCode: 'ORDER_INSERT_FAILED', errorMessage: orderError?.message }
  }

  // 4. Créer les items
  const orderItems = payload.items.map((item) => ({
    store_id: storeId,
    order_id: order.id,
    product_id: null, // On ne peut pas mapper sans SKU → produit existant
    quantity: item.quantity,
    unit_selling_price: item.unit_selling_price,
    unit_purchase_cost_snapshot: 0,
    item_type: 'product',
  }))

  const { error: itemsError } = await supabase.from('order_items').insert(orderItems)

  if (itemsError) {
    // Rollback : supprimer la commande si les items échouent
    await supabase.from('orders').delete().eq('id', order.id)

    await logIngestion(storeId, apiKeyId, payload.external_order_id, 'error', {
      errorCode: 'ORDER_ITEMS_INSERT_FAILED',
      errorMessage: itemsError.message,
      payload,
    })
    return { status: 'rejected', orderId: null, errorCode: 'ORDER_ITEMS_INSERT_FAILED', errorMessage: itemsError.message }
  }

  // 5. Enregistrer l'idempotence
  await recordIdempotency({
    storeId,
    apiKeyId,
    idempotencyKey: payload.idempotency_key,
    payloadHash,
    orderId: order.id,
  })

  // 6. Log de succès
  await logIngestion(storeId, apiKeyId, payload.external_order_id, 'accepted', { payload })

  return { status: 'accepted', orderId: order.id }
}

async function logIngestion(
  storeId: string,
  apiKeyId: string | null,
  externalOrderId: string | undefined,
  status: 'accepted' | 'rejected' | 'duplicate' | 'error',
  extra: { errorCode?: string; errorMessage?: string; payload?: unknown }
) {
  const supabase = await createClient()

  await supabase.from('public_order_ingestion_logs').insert({
    store_id: storeId,
    api_key_id: apiKeyId,
    external_order_id: externalOrderId || null,
    status,
    error_code: extra.errorCode || null,
    error_message: extra.errorMessage || null,
    payload: extra.payload || null,
  })
}
