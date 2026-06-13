import type { SupabaseClient } from '@supabase/supabase-js'
import { createRapidDeliveryParcel, normalizeRapidDeliveryPhone } from '@/lib/integrations/rapid-delivery'
import { getDecryptedIntegrationToken, resolveDefaultRapidDeliveryShopKey } from '@/lib/integrations/rapid-delivery-connect'
import { normalizeOrderCityById } from '@/lib/integrations/city-normalizer'

type AdminClient = SupabaseClient<any, 'public', any>

type OrderLike = {
  id: string
  store_id: string
  city?: string | null
  address?: string | null
  phone?: string | null
  customer_name?: string | null
  total_selling_price?: number | string | null
  tracking_number?: string | null
  delivery_city_external_id?: number | string | null
  order_items?: Array<{ products?: { name?: string | null } | null }> | null
}

export async function autoCreateRapidDeliveryParcelForOrder(params: {
  admin: AdminClient
  userId: string
  integrationId: string
  order: OrderLike
  defaultShopKey: number
  defaultArticleName?: string | null
  deliveryNote?: string
}) {
  const { admin, userId, integrationId, order, defaultShopKey, defaultArticleName, deliveryNote } = params
  const now = new Date().toISOString()
  const existingTracking = String(order.tracking_number || '').trim()

  if (existingTracking) {
    return { warning: '', trackingNumber: existingTracking }
  }

  let cityKey = Number(order.delivery_city_external_id || 0) || 0
  if (!cityKey) {
    const cityMatch = await normalizeOrderCityById(order.id, admin, 'rapid-delivery')
    cityKey = Number(cityMatch.cityKey || 0) || 0
  }

  if (!cityKey) {
    return {
      warning: `Ville non reconnue pour Rapid Delivery: ${String(order.city || '').trim()}`,
      trackingNumber: '',
    }
  }

  const resolvedShopKey = await resolveDefaultRapidDeliveryShopKey({
    client: admin,
    integrationId,
    storeId: order.store_id,
    fallbackShopKey: defaultShopKey,
  })

  if (!resolvedShopKey) {
    return {
      warning: 'Aucun shop Rapid Delivery configuré pour ce store.',
      trackingNumber: '',
    }
  }

  const orderProductNames = (order.order_items || [])
    .map((item) => String(item?.products?.name || '').trim())
    .filter(Boolean)
    .join(', ')

  const article = orderProductNames || String(defaultArticleName || '').trim() || 'Commande'

  const token = await getDecryptedIntegrationToken(admin, integrationId)
  const created = await createRapidDeliveryParcel(token, {
    article,
    price: Number(order.total_selling_price || 0),
    phone: normalizeRapidDeliveryPhone(order.phone || ''),
    city: cityKey,
    shop: resolvedShopKey,
    address: String(order.address || '').trim() || undefined,
    recipient: String(order.customer_name || '').trim() || undefined,
    remark: deliveryNote || undefined,
  })

  const trackingNumber = String(created?.data?.key || '').trim()
  if (!trackingNumber) throw new Error('INVALID_TRACKING_NUMBER')

  const { error: updateOrderError } = await admin
    .from('orders')
    .update({
      tracking_number: trackingNumber,
      rapid_delivery_parcel_key: trackingNumber,
      external_delivery_id: trackingNumber,
      delivery_status: 'pending',
      last_delivery_sync_at: now,
      delivery_city_external_id: cityKey,
      updated_at: now,
    })
    .eq('id', order.id)

  if (updateOrderError) throw updateOrderError

  const { error: mappingError } = await admin.from('rapid_delivery_entity_mappings').upsert(
    {
      user_id: userId,
      integration_id: integrationId,
      store_id: order.store_id,
      entity_type: 'parcel',
      rapid_delivery_id: trackingNumber,
      internal_id: order.id,
      payload: created,
      updated_at: now,
    },
    { onConflict: 'integration_id,entity_type,rapid_delivery_id' }
  )

  if (mappingError) throw mappingError
  return { warning: '', trackingNumber }
}