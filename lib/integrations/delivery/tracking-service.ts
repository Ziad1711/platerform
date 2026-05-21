// ============================================================
// Service de tracking/sync des colis (provider-agnostic)
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DeliveryProvider } from './provider'
import type { DeliveryIntegrationConfig, TrackParcelResult } from './types'
import type { DeliveryLogger } from './logger'

type AdminClient = SupabaseClient<any, 'public', any>

const FINAL_ORDER_STATUSES = ['delivered', 'returned_not_stocked', 'returned_stocked', 'refused']

/**
 * Track un colis et met à jour le statut de la commande
 */
export async function trackAndUpdateOrder(params: {
  admin: AdminClient
  provider: DeliveryProvider
  config: DeliveryIntegrationConfig
  trackingNumber: string
  orderId?: string
  logger: DeliveryLogger
}): Promise<TrackParcelResult> {
  const { admin, provider, config, trackingNumber, orderId, logger } = params

  const startTime = Date.now()
  const result = await provider.trackParcel(config, trackingNumber)
  const durationMs = Date.now() - startTime

  logger.info('track-complete', 'Tracking récupéré', {
    trackingNumber,
    rawStatus: result.rawStatus,
    orderStatus: result.orderStatus,
    deliveryStatus: result.deliveryStatus,
    durationMs,
  })

  if (orderId) {
    const now = new Date().toISOString()
    const updatePayload: Record<string, unknown> = {
      delivery_status: result.deliveryStatus,
      delivery_status_source: result.orderStatus ? 'delivery_company' : null,
      delivery_company_status_raw: result.rawStatus || null,
      last_delivery_sync_at: now,
      updated_at: now,
    }

    if (result.orderStatus) {
      updatePayload.status = result.orderStatus
      updatePayload.last_status_update_at = now
    }

    if (result.statusDateField) {
      updatePayload[result.statusDateField] = now
    }

    const { error } = await admin.from('orders').update(updatePayload).eq('id', orderId)
    if (error) {
      logger.error('track-update-failed', 'Échec mise à jour commande', { orderId, error: error.message })
      throw error
    }

    logger.info('track-order-updated', 'Commande mise à jour', { orderId, newStatus: result.orderStatus })
  }

  return result
}

/**
 * Sync en masse de toutes les commandes non finalisées
 */
export async function syncAllNonFinalOrders(params: {
  admin: AdminClient
  provider: DeliveryProvider
  config: DeliveryIntegrationConfig
  logger: DeliveryLogger
}): Promise<{ synced: number; errors: number }> {
  const { admin, provider, config, logger } = params

  const { data: orders, error: ordersError } = await admin
    .from('orders')
    .select('id, tracking_number, status')
    .not('tracking_number', 'is', null)
    .not('tracking_number', 'eq', '')
    .not('status', 'in', `(${FINAL_ORDER_STATUSES.map((s) => `"${s}"`).join(',')})`)

  if (ordersError) {
    logger.error('sync-all-fetch-failed', 'Échec récupération commandes', { error: ordersError.message })
    throw ordersError
  }

  let synced = 0
  let errors = 0

  for (const order of orders || []) {
    const trackingNumber = String(order.tracking_number || '').trim()
    if (!trackingNumber) continue

    try {
      await trackAndUpdateOrder({
        admin,
        provider,
        config,
        trackingNumber,
        orderId: order.id,
        logger,
      })
      synced += 1
    } catch (error) {
      logger.error('sync-all-order-failed', 'Échec sync commande', {
        orderId: order.id,
        trackingNumber,
        error: error instanceof Error ? error.message : String(error),
      })
      errors += 1
    }
  }

  logger.info('sync-all-complete', 'Sync en masse terminé', { synced, errors })
  return { synced, errors }
}
