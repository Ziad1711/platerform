import type { SupabaseClient } from '@supabase/supabase-js'
import { createRushlivParcel, normalizeRushlivPhone } from '@/lib/integrations/rushliv'
import { getDecryptedIntegrationToken } from '@/lib/integrations/rushliv-connect'
import { normalizeOrderCityById } from '@/lib/integrations/city-normalizer'
import { buildOrderArticleLabel } from '@/lib/integrations/delivery/order-article'

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
  order_items?: Array<{
    product_name_override?: string | null
    products?: { name?: string | null } | null
    product_variants?: { name?: string | null } | null
  }> | null
}

export async function autoCreateRushlivParcelForOrder(params: {
  admin: AdminClient
  userId: string
  integrationId: string
  order: OrderLike
  defaultArticleName?: string | null
  deliveryNote?: string
}) {
  const { admin, userId, integrationId, order, defaultArticleName, deliveryNote } = params
  const now = new Date().toISOString()
  const existingTracking = String(order.tracking_number || '').trim()

  if (existingTracking) {
    return { warning: '', trackingNumber: existingTracking }
  }

  // Rushliv attend un nom de ville : on résout la ville canonique du référentiel.
  let cityName = ''
  let cityKey = String(order.delivery_city_external_id || '').trim()

  if (order.city) {
    const cityMatch = await normalizeOrderCityById(order.id, admin, 'rushliv')
    cityName = String(cityMatch.cityName || '').trim()
    cityKey = String(cityMatch.cityKey || cityKey || '').trim()
  }

  if (!cityName) {
    return {
      warning: `Ville non reconnue pour Rushliv: ${String(order.city || '').trim()}`,
      trackingNumber: '',
    }
  }

  const article = buildOrderArticleLabel(order.order_items, defaultArticleName) || 'Colis e-commerce'

  const token = await getDecryptedIntegrationToken(admin, integrationId)
  const created = await createRushlivParcel(token, {
    name: String(order.customer_name || '').trim() || 'Client',
    phone: normalizeRushlivPhone(order.phone || ''),
    product: article,
    ville: cityName,
    villeType: 'name',
    adresse: String(order.address || '').trim() || undefined,
    note: deliveryNote || undefined,
    price: Number(order.total_selling_price || 0),
  })

  const trackingNumber = String(created?.tracking || '').trim()
  if (!trackingNumber) throw new Error('INVALID_TRACKING_NUMBER')

  const { error: updateOrderError } = await admin
    .from('orders')
    .update({
      tracking_number: trackingNumber,
      rushliv_parcel_key: trackingNumber,
      rushliv_voucher_key: trackingNumber,
      external_delivery_id: trackingNumber,
      delivery_status: 'pending',
      delivery_status_source: 'delivery_company',
      last_delivery_sync_at: now,
      delivery_city_external_id: cityKey || null,
      updated_at: now,
    })
    .eq('id', order.id)

  if (updateOrderError) throw updateOrderError

  const { error: mappingError } = await admin.from('delivery_entity_mappings').upsert(
    {
      user_id: userId,
      integration_id: integrationId,
      store_id: order.store_id,
      entity_type: 'parcel',
      provider_entity_id: trackingNumber,
      internal_id: order.id,
      payload: { provider_slug: 'rushliv', raw: created },
      updated_at: now,
    },
    { onConflict: 'integration_id,entity_type,provider_entity_id' }
  )

  if (mappingError) throw mappingError

  return { warning: '', trackingNumber }
}
