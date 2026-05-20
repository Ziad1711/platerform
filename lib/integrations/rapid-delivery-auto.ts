import type { SupabaseClient } from '@supabase/supabase-js'
import { createRapidDeliveryParcel, normalizeRapidDeliveryPhone, tryTrackRapidDeliveryParcel, extractRapidDeliveryPayloadItem, downloadRapidDeliveryHtml } from '@/lib/integrations/rapid-delivery'
import { getRapidDeliveryIntegrationCredentials, resolveDefaultRapidDeliveryShopKey } from '@/lib/integrations/rapid-delivery-connect'
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
  rapid_delivery_city_key?: number | string | null
  rapid_delivery_parcel_key?: string | null
  order_items?: Array<{ products?: { name?: string | null } | null }> | null
}

function extractShortKeyFromHtml(html: string): string | null {
  // Chercher un pattern qui ressemble à un code court dans le HTML du label
  // Souvent c'est dans une div ou près d'un barcode
  const matches = html.match(/[A-Za-z0-9]{10}/g) || []
  // On élimine les mots courants et on prend le premier qui ressemble à un ID unique
  return matches.find(m => !['Imprimer', 'etiquetes', 'DOCTYPE'].includes(m)) || null
}

export async function autoCreateRapidDeliveryParcelForOrder(params: {
  admin: AdminClient
  userId: string
  integrationId: string
  order: OrderLike
  defaultShopKey: number
  defaultArticleName?: string | null
}) {
  const { admin, userId, integrationId, order, defaultShopKey, defaultArticleName } = params
  const now = new Date().toISOString()
  const existingTracking = String(order.tracking_number || '').trim()

  if (existingTracking && !existingTracking.includes('-')) {
    return { warning: '', trackingNumber: existingTracking }
  }

  let cityKey = Number(order.rapid_delivery_city_key || 0) || 0
  if (!cityKey) {
    const cityMatch = await normalizeOrderCityById(order.id, admin)
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

  const { token, baseUrl } = await getRapidDeliveryIntegrationCredentials(admin, integrationId)

  // 1. Création du colis (récupère l'UUID)
  const created = await createRapidDeliveryParcel(token, {
    article,
    price: Number(order.total_selling_price || 0),
    phone: normalizeRapidDeliveryPhone(order.phone || ''),
    city: cityKey,
    shop: resolvedShopKey,
    address: (order.address && String(order.address).trim()) || undefined,
    recipient: String(order.customer_name || '').trim() || undefined,
  }, baseUrl)

  const uuid = String(created?.data?.key || '').trim()
  if (!uuid) throw new Error('INVALID_TRACKING_NUMBER_UUID')

  // 2. Récupérer le numéro de suivi court (ex: uC6qBO1oBq)
  // On attend un peu que le backend génère le code
  await new Promise(resolve => setTimeout(resolve, 2000))

  let trackingNumber = uuid

  try {
    // Essayer de le trouver dans le tracking JSON
    const remoteParcel = await tryTrackRapidDeliveryParcel(token, uuid, baseUrl)
    const item = extractRapidDeliveryPayloadItem(remoteParcel)

    // Si l'API renvoie toujours l'UUID, on tente de télécharger le label HTML pour extraire le code
    if (!item?.key || String(item.key).includes('-')) {
      const labelHtml = await downloadRapidDeliveryHtml(token, `/parcels/${encodeURIComponent(uuid)}/label`, baseUrl)
      const shortKey = extractShortKeyFromHtml(labelHtml)
      if (shortKey) {
        trackingNumber = shortKey
        console.log('Extracted short key from HTML label', { uuid, shortKey })
      }
    } else {
      trackingNumber = String(item.key).trim()
    }
  } catch (e) {
    console.warn('Failed to fetch short tracking key, falling back to UUID', e)
  }

  const { error: updateOrderError } = await admin
    .from('orders')
    .update({
      tracking_number: trackingNumber,
      rapid_delivery_parcel_key: trackingNumber,
      external_delivery_id: trackingNumber,
      delivery_status: 'pending',
      last_delivery_sync_at: now,
      rapid_delivery_city_key: cityKey,
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
      payload: { ...created, uuid, extracted_tracking: trackingNumber },
      updated_at: now,
    },
    { onConflict: 'integration_id,entity_type,rapid_delivery_id' }
  )

  if (mappingError) throw mappingError
  return { warning: '', trackingNumber }
}