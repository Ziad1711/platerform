import type { SupabaseClient } from '@supabase/supabase-js'
import { createOzoneParcel, extractOzoneTrackingNumber, normalizeOzonePhone, isOzoneDeclaredValueRequired } from '@/lib/integrations/ozone'
import { normalizeOrderCityById } from '@/lib/integrations/city-normalizer'
import { getDecryptedIntegrationToken } from '@/lib/integrations/rapid-delivery-connect'
import { createDeliveryLogger } from '@/lib/integrations/delivery/logger'

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
  parcelOptions?: {
    open?: 1 | 2
    fragile?: 0 | 1
    replace?: 0 | 1
  }
}) {
  const { admin, userId, integrationId, order, defaultArticleName, deliveryNote, parcelOptions } = params
  const now = new Date().toISOString()
  const existingTracking = String(order.tracking_number || '').trim()
  const logger = createDeliveryLogger({
    admin,
    integrationId,
    storeId: order.store_id,
    userId,
  })

  logger.info('ozone-auto-start', 'Début auto-création colis OZONE', {
    orderId: order.id,
    city: order.city,
    hasTracking: Boolean(existingTracking),
  })

  if (existingTracking) {
    logger.info('ozone-auto-skip-existing-tracking', 'Commande déjà suivie', { trackingNumber: existingTracking })
    return { warning: '', trackingNumber: existingTracking }
  }

  let cityKey = Number(order.delivery_city_external_id || 0) || 0
  if (!cityKey) {
    const cityMatch = await normalizeOrderCityById(order.id, admin, 'ozone')
    cityKey = Number(cityMatch.cityKey || 0) || 0
  }

  if (!cityKey) {
    logger.warn('ozone-auto-city-not-found', 'Ville OZONE non reconnue', { orderId: order.id, city: order.city })
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

  // Récupérer la config OZONE
  const { data: integration, error: integrationError } = await admin
    .from('integrations')
    .select('id, status')
    .eq('id', integrationId)
    .maybeSingle()

  if (integrationError || !integration || integration.status !== 'connected') {
    logger.warn('ozone-auto-not-connected', 'Intégration OZONE non connectée', {
      integrationError: integrationError?.message,
      integrationStatus: integration?.status,
    })
    return { warning: 'Intégration OZONE non connectée.', trackingNumber: '' }
  }

  let decrypted = ''
  try {
    decrypted = await getDecryptedIntegrationToken(admin, integrationId)
  } catch (error) {
    logger.error('ozone-auto-token-decrypt-failed', 'Impossible de décrypter le token OZONE', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { warning: 'Impossible de décrypter le token OZONE.', trackingNumber: '' }
  }

  const [customerId, apiKey] = String(decrypted || '').split('|').map((part) => part.trim())
  if (!customerId || !apiKey) {
    logger.warn('ozone-auto-token-invalid', 'Token OZONE invalide', { tokenParts: String(decrypted || '').split('|').length })
    return { warning: 'Token OZONE invalide.', trackingNumber: '' }
  }

  const config = { customerId, apiKey }

  const price = Number(order.total_selling_price || 0)
  const parcelPayload: any = {
    'parcel-nature': article,
    'parcel-phone': normalizeOzonePhone(order.phone || ''),
    'parcel-city': cityKey,
    'parcel-price': price,
    'parcel-address': String(order.address || '').trim() || 'Adresse non spécifiée',
    'parcel-receiver': String(order.customer_name || '').trim() || 'Client',
    'parcel-stock': 0,
  }

  if (isOzoneDeclaredValueRequired(price)) {
    parcelPayload['parcel-declared-value'] = price
  }

  if (deliveryNote) {
    parcelPayload['parcel-note'] = deliveryNote
  }

  if (parcelOptions?.open) parcelPayload['parcel-open'] = parcelOptions.open
  if (parcelOptions?.fragile !== undefined) parcelPayload['parcel-fragile'] = parcelOptions.fragile
  if (parcelOptions?.replace !== undefined) parcelPayload['parcel-replace'] = parcelOptions.replace

  logger.info('ozone-auto-create-request', 'Envoi création colis vers OZONE', {
    orderId: order.id,
    cityKey,
    price,
    phoneLength: String(parcelPayload['parcel-phone'] || '').length,
    hasAddress: Boolean(parcelPayload['parcel-address']),
  })

  let created
  try {
    created = await createOzoneParcel(config, parcelPayload)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('ozone-auto-create-failed', 'Échec appel API création colis OZONE', {
      orderId: order.id,
      error: message,
      cityKey,
      price,
    })
    throw new Error(`OZONE_CREATE_PARCEL_FAILED:${message}`)
  }

  logger.info('ozone-auto-create-response', 'Réponse création colis OZONE reçue', {
    success: created?.success,
    message: created?.message,
    trackingNumber: created?.['TRACKING-NUMBER'],
    trackingNumberAlt: created?.TRACKING_NUMBER,
    rootTracking: created?.tracking,
    result: created?.['ADD-PARCEL']?.RESULT,
    addParcelMessage: created?.['ADD-PARCEL']?.MESSAGE,
    nestedTrackingNumber: (created?.['ADD-PARCEL']?.['NEW-PARCEL'] as any)?.['TRACKING-NUMBER'],
    ref: created?.data?.ref,
    tracking: created?.data?.tracking,
  })

  const trackingNumber = extractOzoneTrackingNumber(created)
  if (!trackingNumber) {
    logger.error('ozone-auto-invalid-tracking', 'Réponse OZONE sans tracking valide', { response: created as any })
    throw new Error('OZONE_INVALID_TRACKING_NUMBER')
  }

  const { error: updateOrderError } = await admin
    .from('orders')
    .update({
      tracking_number: trackingNumber,
      external_delivery_id: trackingNumber,
      delivery_status: 'pending',
      delivery_status_source: 'delivery_company',
      last_delivery_sync_at: now,
      delivery_city_external_id: cityKey,
      updated_at: now,
    })
    .eq('id', order.id)

  if (updateOrderError) {
    logger.error('ozone-auto-update-order-failed', 'Échec mise à jour commande après création OZONE', {
      error: updateOrderError.message,
      trackingNumber,
    })
    throw updateOrderError
  }

  logger.info('ozone-auto-complete', 'Colis OZONE créé et commande mise à jour', { trackingNumber })
  return { warning: '', trackingNumber }
}
