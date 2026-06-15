// ============================================================
// Service de création de colis (provider-agnostic)
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DeliveryProvider } from './provider'
import type { DeliveryIntegrationConfig, OrderDeliveryInfo, CreateParcelResult } from './types'
import type { DeliveryLogger } from './logger'
import { normalizeOrderCityById } from '@/lib/integrations/city-normalizer'

type AdminClient = SupabaseClient<any, 'public', any>

export type CreateParcelServiceInput = {
  admin: AdminClient
  provider: DeliveryProvider
  config: DeliveryIntegrationConfig
  order: OrderDeliveryInfo
  defaultShopKey: number
  defaultArticleName?: string | null
  parcelOptions?: {
    open?: 1 | 2
    fragile?: 0 | 1
    replace?: 0 | 1
  }
  logger: DeliveryLogger
}

export type CreateParcelServiceResult = {
  trackingNumber: string
  warning: string
}

/**
 * Résout le shop par défaut pour un provider donné
 */
async function resolveDefaultShopKey(params: {
  client: AdminClient
  integrationId: string
  storeId: string
  fallbackShopKey?: number | null
}) {
  const direct = Number(params.fallbackShopKey || 0) || 0
  if (direct) return direct

  const { data, error } = await params.client
    .from('delivery_shops')
    .select('external_shop_id')
    .eq('integration_id', params.integrationId)
    .eq('store_id', params.storeId)
    .order('external_shop_id', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return Number(data?.external_shop_id || 0) || 0
}

/**
 * Crée un colis pour une commande via le provider spécifié.
 * Gère la normalisation de ville, résolution de shop, création du colis,
 * résolution de clé courte, et mise à jour des tables.
 */
export async function createParcelForOrder(input: CreateParcelServiceInput): Promise<CreateParcelServiceResult> {
  const { admin, provider, config, order, defaultShopKey, defaultArticleName, parcelOptions, logger } = input
  const now = new Date().toISOString()
  const existingTracking = String(order.trackingNumber || '').trim()

  // Si déjà un tracking valide, on skip
  if (existingTracking && !existingTracking.includes('-')) {
    logger.info('parcel-skip', 'Commande déjà suivie', { trackingNumber: existingTracking })
    return { warning: '', trackingNumber: existingTracking }
  }

  // 1. Normaliser la ville
  let cityKey = Number(order.deliveryCityKey || order.rapidDeliveryCityKey || 0) || 0
  if (!cityKey) {
    const cityMatch = await normalizeOrderCityById(order.id, admin, provider.slug)
    cityKey = Number(cityMatch.cityKey || 0) || 0
  }

  if (!cityKey) {
    const warning = `Ville non reconnue: ${String(order.city || '').trim()}`
    logger.warn('parcel-city-not-found', warning, { orderId: order.id, city: order.city })
    return { warning, trackingNumber: '' }
  }

  // 2. Résoudre le shop
  const resolvedShopKey = await resolveDefaultShopKey({
    client: admin,
    integrationId: config.integrationId,
    storeId: config.storeId,
    fallbackShopKey: defaultShopKey,
  })

  if (!resolvedShopKey) {
    const warning = 'Aucun shop configuré pour ce store.'
    logger.warn('parcel-no-shop', warning, { storeId: config.storeId })
    return { warning, trackingNumber: '' }
  }

  // 3. Préparer le nom d'article
  const orderProductNames = (order.orderItems || [])
    .map((item) => String(item?.productName || '').trim())
    .filter(Boolean)
    .join(', ')
  const article = orderProductNames || String(defaultArticleName || '').trim() || 'Commande'

  // 4. Créer le colis
  const startTime = Date.now()
  const result: CreateParcelResult = await provider.createParcel(config, {
    articleName: article,
    price: Number(order.totalSellingPrice || 0),
    phone: String(order.phone || ''),
    cityKey: cityKey,
    shopKey: resolvedShopKey,
    address: (order.address && String(order.address).trim()) || undefined,
    recipient: String(order.customerName || '').trim() || undefined,
    options: parcelOptions,
  })
  const durationMs = Date.now() - startTime

  logger.info('parcel-created', 'Colis créé avec succès', {
    orderId: order.id,
    providerId: result.providerId,
    durationMs,
  })

  // 5. Résoudre la clé courte si le provider le supporte
  let trackingNumber = result.providerId
  if (provider.resolveShortTrackingKey && result.providerId.includes('-')) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    const shortKey = await provider.resolveShortTrackingKey(config, result.providerId)
    if (shortKey) {
      trackingNumber = shortKey
      logger.info('parcel-short-key-resolved', 'Clé courte résolue', { uuid: result.providerId, shortKey })
    }
  }

  // 6. Mettre à jour la commande
  const updatePayload: Record<string, unknown> = {
    tracking_number: trackingNumber,
    external_delivery_id: trackingNumber,
    delivery_status: 'pending',
    delivery_status_source: 'delivery_company',
    last_delivery_sync_at: now,
    delivery_city_external_id: cityKey,
    updated_at: now,
  }

  if (provider.slug === 'rapid-delivery') {
    updatePayload.rapid_delivery_parcel_key = trackingNumber
  }

  const { error: updateOrderError } = await admin
    .from('orders')
    .update(updatePayload)
    .eq('id', order.id)

  if (updateOrderError) {
    logger.error('parcel-update-order-failed', 'Échec mise à jour commande', { error: updateOrderError.message })
    throw updateOrderError
  }

  // 7. Créer le mapping dans delivery_entity_mappings (provider-agnostic)
  const { error: mappingError } = await admin.from('delivery_entity_mappings').upsert(
    {
      user_id: config.userId,
      integration_id: config.integrationId,
      store_id: config.storeId,
      entity_type: 'parcel',
      provider_entity_id: trackingNumber,
      internal_id: order.id,
      payload: { raw: result.raw, uuid: result.providerId, extracted_tracking: trackingNumber, provider_slug: provider.slug },
      updated_at: now,
    },
    { onConflict: 'integration_id,entity_type,provider_entity_id' }
  )

  if (mappingError) {
    logger.error('parcel-mapping-failed', 'Échec création mapping', { error: mappingError.message })
    throw mappingError
  }

  if (provider.slug === 'rapid-delivery') {
    const { error: legacyMappingError } = await admin.from('rapid_delivery_entity_mappings').upsert(
      {
        user_id: config.userId,
        integration_id: config.integrationId,
        store_id: config.storeId,
        entity_type: 'parcel',
        rapid_delivery_id: trackingNumber,
        internal_id: order.id,
        payload: { raw: result.raw, uuid: result.providerId, extracted_tracking: trackingNumber },
        updated_at: now,
      },
      { onConflict: 'integration_id,entity_type,rapid_delivery_id' }
    )

    if (legacyMappingError) {
      logger.error('parcel-legacy-mapping-failed', 'Échec création mapping legacy', { error: legacyMappingError.message })
      throw legacyMappingError
    }
  }

  logger.info('parcel-complete', 'Création colis terminée', { trackingNumber })
  return { warning: '', trackingNumber }
}
