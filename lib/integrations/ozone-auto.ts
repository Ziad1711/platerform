import type { SupabaseClient } from '@supabase/supabase-js'
import { createOzoneParcel, normalizeOzonePhone, isOzoneDeclaredValueRequired } from '@/lib/integrations/ozone'
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

export async function autoCreateOzoneParcelForOrder(params: {
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

  let cityKey = Number(order.delivery_city_external_id || 0) || 0
  if (!cityKey) {
    const cityMatch = await normalizeOrderCityById(order.id, admin, 'ozone')
    cityKey = Number(cityMatch.cityKey || 0) || 0
  }

  if (!cityKey) {
    return {
      warning: `Ville non reconnue pour OZONE: ${String(order.city || '').trim()}`,
      trackingNumber: '',
    }
  }

  const orderProductNames = (order.order_items || [])
    .map((item) => String(item?.products?.name || '').trim())
    .filter(Boolean)
    .join(', ')

  const article = orderProductNames || String(defaultArticleName || '').trim() || 'Commande'

  // Récupérer la config OZONE (token decrypté)
  const { data: integration, error: integrationError } = await admin
    .from('integrations')
    .select('id, status, token')
    .eq('id', integrationId)
    .maybeSingle()

  if (integrationError || !integration || integration.status !== 'connected') {
    return { warning: 'Intégration OZONE non connectée.', trackingNumber: '' }
  }

  // Décrypter le token (JSON: { customerId, apiKey })
  const { data: decrypted, error: decryptError } = await admin.rpc('decrypt_integration_token', {
    encrypted_token: integration.token,
  })

  if (decryptError || !decrypted) {
    return { warning: 'Impossible de décrypter le token OZONE.', trackingNumber: '' }
  }

  let config: { customerId: string; apiKey: string }
  try {
    config = typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted
  } catch {
    return { warning: 'Token OZONE invalide.', trackingNumber: '' }
  }

  const price = Number(order.total_selling_price || 0)
  const parcelPayload: any = {
    'parcel-name': article,
    'parcel-phone': normalizeOzonePhone(order.phone || ''),
    'parcel-city': cityKey,
    'parcel-price': price,
    'parcel-address': String(order.address || '').trim() || 'Adresse non spécifiée',
    'parcel-receiver-name': String(order.customer_name || '').trim() || 'Client',
    'parcel-stock': 0,
  }

  if (isOzoneDeclaredValueRequired(price)) {
    parcelPayload['parcel-declared-value'] = price
  }

  if (deliveryNote) {
    parcelPayload['parcel-remark'] = deliveryNote
  }

  const created = await createOzoneParcel(config, parcelPayload)

  const trackingNumber = String(created?.data?.tracking || created?.data?.ref || '').trim()
  if (!trackingNumber) throw new Error('OZONE_INVALID_TRACKING_NUMBER')

  const { error: updateOrderError } = await admin
    .from('orders')
    .update({
      tracking_number: trackingNumber,
      ozone_parcel_key: trackingNumber,
      external_delivery_id: trackingNumber,
      delivery_status: 'pending',
      last_delivery_sync_at: now,
      delivery_city_external_id: cityKey,
      updated_at: now,
    })
    .eq('id', order.id)

  if (updateOrderError) throw updateOrderError

  return { warning: '', trackingNumber }
}
