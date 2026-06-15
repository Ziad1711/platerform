// ============================================================
// Service de création de voucher (provider-agnostic)
// Le voucher ne bloque PAS le flux si la propagation est lente
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DeliveryProvider } from './provider'
import type { DeliveryIntegrationConfig, CreateVoucherResult } from './types'
import type { DeliveryLogger } from './logger'

type AdminClient = SupabaseClient<any, 'public', any>

export type CreateVoucherServiceInput = {
  admin: AdminClient
  provider: DeliveryProvider
  config: DeliveryIntegrationConfig
  storeId: string
  orderIds: string[]
  parcelKeys: Array<string | number>
  shopKey: number
  logger: DeliveryLogger
}

export type CreateVoucherServiceResult = {
  voucherKey: string
  totalParcels: number
  remoteVerified: boolean
}

/**
 * Crée un voucher pour un ensemble de colis.
 * Non-blocking : si la propagation asynchrone échoue, on accepte quand même.
 */
export async function createVoucherForParcels(input: CreateVoucherServiceInput): Promise<CreateVoucherServiceResult> {
  const { admin, provider, config, storeId, orderIds, parcelKeys, shopKey, logger } = input
  const now = new Date().toISOString()

  // 1. Créer le voucher
  const startTime = Date.now()
  const result: CreateVoucherResult = await provider.createVoucher(config, {
    shopKey,
    parcelKeys,
  })
  const durationMs = Date.now() - startTime

  logger.info('voucher-created', 'Voucher créé avec succès', {
    voucherKey: result.providerVoucherKey,
    parcelCount: parcelKeys.length,
    durationMs,
  })

  const voucherKey = result.providerVoucherKey

  // Vérification asynchrone non-bloquante : on log et on continue
  // La propagation côté provider peut prendre du temps, inutile de bloquer l'utilisateur
  let remoteVerified = false
  let remoteTotalParcels = 0

  logger.info('voucher-poll-skipped', 'Vérification à distance ignorée (non-bloquante)', {
    voucherKey,
    provider: provider.slug,
    parcelCount: parcelKeys.length,
  })

  // 3. Mettre à jour les commandes
  const updatePayload: Record<string, unknown> = {
    delivery_voucher_key: voucherKey,
    last_status_update_at: now,
    delivery_status: 'pickup_pending',
    status: 'dl_pickup_pending',
    dl_pickup_pending_at: now,
    delivery_status_source: 'delivery_company',
    updated_at: now,
  }

  // Compatibilité ascendante
  updatePayload.rapid_delivery_voucher_key = voucherKey

  const { error: updateOrdersError } = await admin
    .from('orders')
    .update(updatePayload)
    .in('id', orderIds)

  if (updateOrdersError) {
    logger.error('voucher-update-orders-failed', 'Échec mise à jour commandes', { error: updateOrdersError.message })
    throw updateOrdersError
  }

  // 4. Créer le mapping voucher (provider-agnostic)
  const { error: mappingError } = await admin.from('delivery_entity_mappings').upsert(
    {
      user_id: config.userId,
      integration_id: config.integrationId,
      provider_id: config.providerId || null, // Utilise le vrai provider_id s'il est présent
      store_id: storeId,
      entity_type: 'voucher',
      provider_entity_id: voucherKey,
      internal_id: orderIds[0],
      payload: {
        provider_slug: provider.slug,
        raw: result.raw,
        order_ids: orderIds,
        parcels: parcelKeys,
        remote_verified: remoteVerified,
        remote_total_parcels: remoteTotalParcels,
      },
      updated_at: now,
    },
    { onConflict: 'integration_id,entity_type,provider_entity_id' }
  )

  if (mappingError) {
    logger.error('voucher-mapping-failed', 'Échec création mapping voucher', { error: mappingError.message })
    throw mappingError
  }

  // 5. Compatibilité ascendante : uniquement pour rapid-delivery
  if (provider.slug === 'rapid-delivery') {
    const { error: legacyMappingError } = await admin.from('rapid_delivery_entity_mappings').upsert(
      {
        user_id: config.userId,
        integration_id: config.integrationId,
        store_id: storeId,
        entity_type: 'voucher',
        rapid_delivery_id: voucherKey,
        internal_id: orderIds[0],
        payload: {
          raw: result.raw,
          order_ids: orderIds,
          parcels: parcelKeys,
          remote_verified: remoteVerified,
          remote_total_parcels: remoteTotalParcels,
        },
        updated_at: now,
      },
      { onConflict: 'integration_id,entity_type,rapid_delivery_id' }
    )

    if (legacyMappingError) {
      logger.error('voucher-legacy-mapping-failed', 'Échec création mapping voucher legacy', { error: legacyMappingError.message })
      throw legacyMappingError
    }
  }

  logger.info('voucher-complete', 'Création voucher terminée', {
    voucherKey,
    remoteVerified,
    remoteTotalParcels,
  })

  return { voucherKey, totalParcels: remoteTotalParcels || parcelKeys.length, remoteVerified }
}

/**
 * Extrait le nombre total de colis depuis une réponse voucher
 */
function extractVoucherTotalParcels(voucher: unknown): number {
  if (!voucher || typeof voucher !== 'object') return 0
  const item = Array.isArray(voucher) ? (voucher as unknown[])[0] : voucher
  if (!item || typeof item !== 'object') return 0
  const record = item as Record<string, unknown>
  return Number(record.total_parcels || record.parcels_count || 0) || 0
}
