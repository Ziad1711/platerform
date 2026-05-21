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

  // 2. Vérifier via GET /vouchers/{key} (propagation asynchrone)
  let remoteVerified = false
  let remoteTotalParcels = 0

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    try {
      const remoteVoucher = await provider.getVoucher(config, voucherKey)
      const item = extractVoucherTotalParcels(remoteVoucher)
      remoteTotalParcels = item
      logger.info('voucher-poll', `Vérification voucher tentative ${attempt + 1}`, {
        voucherKey,
        remoteTotalParcels,
      })
      if (remoteTotalParcels > 0) {
        remoteVerified = true
        break
      }
    } catch (e) {
      logger.warn('voucher-poll-failed', `Échec vérification tentative ${attempt + 1}`, {
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  if (!remoteVerified) {
    logger.warn('voucher-remote-empty', 'Voucher créé mais vide à distance (propagation lente)', {
      voucherKey,
      shopKey,
      parcelKeys,
    })
  }

  // 3. Mettre à jour les commandes
  const { error: updateOrdersError } = await admin
    .from('orders')
    .update({
      rapid_delivery_voucher_key: voucherKey,
      last_status_update_at: now,
      delivery_status: 'pickup_pending',
      updated_at: now,
    })
    .in('id', orderIds)

  if (updateOrdersError) {
    logger.error('voucher-update-orders-failed', 'Échec mise à jour commandes', { error: updateOrdersError.message })
    throw updateOrdersError
  }

  // 4. Créer le mapping voucher
  const { error: mappingError } = await admin.from('rapid_delivery_entity_mappings').upsert(
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

  if (mappingError) {
    logger.error('voucher-mapping-failed', 'Échec création mapping voucher', { error: mappingError.message })
    throw mappingError
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
