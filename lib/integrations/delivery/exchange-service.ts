// ============================================================
// Service d'échange de colis (Rapid Delivery / Maroc Go Delivery)
// Aucune API d'échange chez ces transporteurs : on vérifie le nouvel ID de
// colis via leur API de suivi, puis on crée la commande de remplacement.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { getDecryptedIntegrationToken } from '@/lib/integrations/rapid-delivery-connect'
import {
  getRapidDeliveryStateName,
  mapRapidDeliveryStateToOrderStatus,
  trackRapidDeliveryParcel,
} from '@/lib/integrations/rapid-delivery'
import {
  getMarocGoDeliveryStateName,
  mapMarocGoDeliveryStateToOrderStatus,
  trackMarocGoDeliveryParcel,
} from '@/lib/integrations/maroc-go-delivery'
import type { ExchangeProviderSlug } from './exchange-providers'

type AdminClient = SupabaseClient<any, 'public', any>

export type ExchangeCarrierState = {
  rawStatus: string
  orderStatus: string | null
  deliveryStatus: string
  statusDateField: string | null
}

/**
 * Interroge l'API de suivi du transporteur pour un numéro de colis donné.
 * Sert à valider l'ID collé par l'utilisateur avant tout rattachement.
 */
export async function trackExchangeParcel(params: {
  admin: AdminClient
  integrationId: string
  providerSlug: ExchangeProviderSlug
  parcelKey: string
}): Promise<ExchangeCarrierState> {
  const token = await getDecryptedIntegrationToken(params.admin, params.integrationId)

  if (params.providerSlug === 'maroc-go-delivery') {
    const payload = await trackMarocGoDeliveryParcel(token, params.parcelKey)
    return mapMarocGoDeliveryStateToOrderStatus(getMarocGoDeliveryStateName(payload))
  }

  const payload = await trackRapidDeliveryParcel(token, params.parcelKey)
  return mapRapidDeliveryStateToOrderStatus(getRapidDeliveryStateName(payload))
}

/**
 * Clé du colis d'origine chez le transporteur : c'est ce colis qui basculera
 * sur l'état « Retour/Echange » après la demande.
 */
export function getOriginalParcelKey(
  order: Record<string, any> | null | undefined,
  providerSlug: ExchangeProviderSlug
) {
  if (!order) return ''
  const providerKey =
    providerSlug === 'maroc-go-delivery'
      ? order.maroc_go_delivery_parcel_key
      : order.rapid_delivery_parcel_key
  return String(providerKey || order.tracking_number || '').trim()
}

/**
 * Crée la commande de remplacement (colis neuf créé chez le transporteur lors
 * de la demande d'échange) et la relie à la commande d'origine.
 * Idempotent : une seule commande de remplacement par commande d'origine.
 */
export async function createExchangeReplacementOrder(params: {
  admin: AdminClient
  originalOrder: Record<string, any>
  providerSlug: ExchangeProviderSlug
  newParcelKey: string
}) {
  const { admin, originalOrder, providerSlug, newParcelKey } = params
  const now = new Date().toISOString()
  const shortId = String(originalOrder.id || '').slice(0, 8)

  const { data: existingReplacement, error: existingReplacementError } = await admin
    .from('orders')
    .select('id, status')
    .eq('exchange_original_order_id', originalOrder.id)
    .maybeSingle()

  if (existingReplacementError) throw existingReplacementError
  if (existingReplacement) return existingReplacement as { id: string; status: string }

  const orderPayload: Record<string, any> = {
    store_id: originalOrder.store_id,
    order_date: now,
    customer_name: originalOrder.customer_name,
    phone: originalOrder.phone || null,
    address: originalOrder.address || null,
    city: originalOrder.city || null,
    status: 'confirmed',
    confirmed_at: now,
    total_selling_price: Number(originalOrder.total_selling_price || 0),
    delivery_fee: Number(originalOrder.delivery_fee || 0),
    delivery_charge_to_customer: Number(originalOrder.delivery_charge_to_customer || 0),
    discount_type: originalOrder.discount_type || null,
    discount_value: Number(originalOrder.discount_value || 0),
    discount_amount: Number(originalOrder.discount_amount || 0),
    subtotal_amount: Number(originalOrder.subtotal_amount || 0),
    source: 'exchange',
    // Pas de nouveau coût publicitaire : l'échange ne relance pas d'acquisition.
    ads_cost_allocated: 0,
    confirmation_cost_allocated: 0,
    delivery_company_id: originalOrder.delivery_company_id || null,
    confirmation_agent_id: originalOrder.confirmation_agent_id || null,
    delivery_city_external_id: originalOrder.delivery_city_external_id || null,
    tracking_number: newParcelKey,
    external_delivery_id: newParcelKey,
    delivery_status: 'pending',
    delivery_status_source: 'delivery_company',
    last_delivery_sync_at: now,
    last_status_update_at: now,
    delivery_note: `Échange de la commande #${shortId}`,
    exchange_original_order_id: originalOrder.id,
  }

  if (providerSlug === 'maroc-go-delivery') {
    orderPayload.maroc_go_delivery_parcel_key = newParcelKey
  } else {
    orderPayload.rapid_delivery_parcel_key = newParcelKey
  }

  const { data: replacementOrder, error: replacementError } = await admin
    .from('orders')
    .insert(orderPayload)
    .select('id, status')
    .single()

  if (replacementError) {
    // Course concurrente : une autre requête a déjà créé le remplacement.
    if ((replacementError as any)?.code === '23505') {
      const { data: concurrentReplacement } = await admin
        .from('orders')
        .select('id, status')
        .eq('exchange_original_order_id', originalOrder.id)
        .maybeSingle()

      if (concurrentReplacement) return concurrentReplacement as { id: string; status: string }
    }

    throw replacementError
  }

  const { data: sourceItems, error: sourceItemsError } = await admin
    .from('order_items')
    .select('product_id, quantity, unit_selling_price, unit_purchase_cost_snapshot, item_type, product_variant_id, product_name_override')
    .eq('order_id', originalOrder.id)

  if (sourceItemsError) throw sourceItemsError

  if (sourceItems && sourceItems.length > 0) {
    const itemsPayload = sourceItems.map((item: any) => ({
      store_id: originalOrder.store_id,
      order_id: replacementOrder.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_selling_price: item.unit_selling_price,
      unit_purchase_cost_snapshot: item.unit_purchase_cost_snapshot,
      item_type: item.item_type,
      product_variant_id: item.product_variant_id || null,
      product_name_override: item.product_name_override || null,
    }))

    const { error: itemsError } = await admin.from('order_items').insert(itemsPayload)
    if (itemsError) {
      // Évite de laisser une commande de remplacement orpheline sans lignes.
      await admin.from('orders').delete().eq('id', replacementOrder.id)
      throw itemsError
    }
  }

  return replacementOrder as { id: string; status: string }
}
