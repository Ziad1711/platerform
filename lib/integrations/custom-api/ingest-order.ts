import { createAdminClient } from '@/lib/supabase/admin'
import { computePayloadHash } from './idempotency'
import { normalizeCityName } from '@/lib/integrations/city-normalizer'
import { resolveDeliveryFee } from '@/lib/integrations/delivery/delivery-fee-resolver'
import { normalizeMoroccanPhone } from '@/lib/utils'
import { resolveOrderItemsPricing, resolveOrderTotal } from './order-items-pricing'

export type IngestOrderPayload = {
  idempotency_key: string
  external_order_id: string
  customer_name: string
  phone?: string
  city?: string
  address?: string
  /** Optionnel : le total est recalculé côté Jisra à partir des prix officiels. */
  total_selling_price?: number
  delivery_charge_to_customer?: number
  delivery_note?: string
  discount_type?: 'fixed' | 'amount' | 'percentage'
  discount_value?: number
  discount_amount?: number
  subtotal_amount?: number
  source?: 'organic' | 'ads' | 'recommendation'
  order_date?: string
  items: Array<{
    product_id: string
    product_name?: string
    product_sku?: string
    product_variant_id?: string | null
    quantity: number
    /** Optionnel : le prix appliqué est celui enregistré dans Jisra. */
    unit_selling_price?: number
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
  const supabase = createAdminClient()
  const payloadHash = computePayloadHash(payload)

  // 1. Valider les champs requis
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

  // 2. Valider le rattachement produit / variante ET appliquer les prix Jisra.
  // Mode strict : le prix envoyé par le site est ignoré, seuls les prix
  // enregistrés dans Jisra sont utilisés (les écarts sont journalisés).
  //
  // Stock : politique « informatif » — aucune commande n'est refusée pour cause
  // de stock. L'endpoint de disponibilité sert uniquement à prévenir le site ;
  // le stock peut devenir négatif puis être régularisé (retour / inventaire).
  const pricing = await resolveOrderItemsPricing(storeId, payload.items)

  if (pricing.error) {
    await logIngestion(storeId, apiKeyId, payload.external_order_id, 'rejected', {
      errorCode: pricing.error.errorCode,
      errorMessage: pricing.error.errorMessage,
      payload,
    })
    return {
      status: 'rejected',
      orderId: null,
      errorCode: pricing.error.errorCode,
      errorMessage: pricing.error.errorMessage,
    }
  }

  const resolvedItems = pricing.items
  const itemsTotal = resolvedItems.reduce(
    (sum, item) => sum + item.unit_selling_price * item.quantity,
    0
  )

  const resolvedTotal = resolveOrderTotal({
    itemsTotal,
    discountAmount: Number(payload.discount_amount || 0),
    deliveryChargeToCustomer: Number(payload.delivery_charge_to_customer || 0),
  })

  // 3. Créer la commande de façon atomique (idempotence + commande + articles)
  const { data, error: orderError } = await supabase.rpc('rpc_ingest_public_order', {
    p_store_id: storeId,
    p_api_key_id: apiKeyId,
    p_idempotency_key: payload.idempotency_key,
    p_payload_hash: payloadHash,
    p_order: {
      external_order_id: payload.external_order_id,
      customer_name: payload.customer_name.trim(),
      phone: normalizeMoroccanPhone(payload.phone) || null,
      city: payload.city || null,
      address: payload.address || null,
      total_selling_price: resolvedTotal,
      delivery_charge_to_customer: payload.delivery_charge_to_customer ?? 0,
      delivery_note: payload.delivery_note || null,
      discount_type: payload.discount_type || null,
      discount_value: payload.discount_value ?? 0,
      discount_amount: payload.discount_amount ?? 0,
      subtotal_amount: payload.subtotal_amount ?? 0,
      source: payload.source || 'organic',
      order_date: payload.order_date || new Date().toISOString(),
    },
    p_items: resolvedItems.map((item) => ({
      product_id: item.product_id,
      product_variant_id: item.product_variant_id,
      quantity: item.quantity,
      unit_selling_price: item.unit_selling_price,
    })),
  })

  if (orderError) {
    await logIngestion(storeId, apiKeyId, payload.external_order_id, 'error', {
      errorCode: 'ORDER_INSERT_FAILED',
      errorMessage: orderError.message,
      payload,
    })
    return {
      status: 'rejected',
      orderId: null,
      errorCode: 'ORDER_INSERT_FAILED',
      errorMessage: "Erreur lors de l'envoi de la commande",
    }
  }

  // 4. Résultat de l'ingestion atomique
  const result = (data || {}) as { status?: string; order_id?: string | null }

  if (result.status === 'duplicate') {
    await logIngestion(storeId, apiKeyId, payload.external_order_id, 'duplicate', {
      errorCode: 'IDEMPOTENCY_DUPLICATE',
      errorMessage: 'Cette commande a déjà été importée',
      payload,
    })
    return { status: 'duplicate', orderId: result.order_id || null }
  }

  if (result.status === 'conflict') {
    await logIngestion(storeId, apiKeyId, payload.external_order_id, 'rejected', {
      errorCode: 'IDEMPOTENCY_CONFLICT',
      errorMessage: "idempotency_key déjà utilisée avec un contenu différent",
      payload,
    })
    return {
      status: 'rejected',
      orderId: null,
      errorCode: 'IDEMPOTENCY_CONFLICT',
      errorMessage: "idempotency_key déjà utilisée avec un contenu différent pour cette commande",
    }
  }

  if (result.status !== 'accepted' || !result.order_id) {
    await logIngestion(storeId, apiKeyId, payload.external_order_id, 'error', {
      errorCode: 'ORDER_INSERT_FAILED',
      errorMessage: `Statut d'ingestion inattendu : ${result.status || 'inconnu'}`,
      payload,
    })
    return {
      status: 'rejected',
      orderId: null,
      errorCode: 'ORDER_INSERT_FAILED',
      errorMessage: "Erreur lors de l'envoi de la commande",
    }
  }

  // 5. Écarts de prix (informationnel : le prix Jisra a été appliqué)
  if (pricing.mismatches.length > 0) {
    await logIngestion(storeId, apiKeyId, payload.external_order_id, 'accepted', {
      errorCode: 'PRICE_MISMATCH',
      errorMessage: `${pricing.mismatches.length} prix différent(s) du prix Jisra ont été remplacés`,
      payload: pricing.mismatches,
    })
  }

  // 6. Log de succès
  await logIngestion(storeId, apiKeyId, payload.external_order_id, 'accepted', { payload })

  return { status: 'accepted', orderId: result.order_id }
}

async function logIngestion(
  storeId: string,
  apiKeyId: string | null,
  externalOrderId: string | undefined,
  status: 'accepted' | 'rejected' | 'duplicate' | 'error',
  extra: { errorCode?: string; errorMessage?: string; payload?: unknown; normalizationContext?: unknown }
) {
  const supabase = createAdminClient()

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
