// ============================================================
// Service de tracking/sync des colis (provider-agnostic).
//
// Le suivi est porte par le service partage (`tracking-runner.ts` +
// `apply-tracked-status.ts`). Ce fichier ne conserve qu'un point d'entree
// historique, qui applique EXACTEMENT les memes regles : lecture de la
// commande complete (dates metier + version), puis ecriture conditionnelle.
//
// L'ancienne fonction `syncAllNonFinalOrders` a ete supprimee : elle lisait
// les commandes sans filtrage explicite par store et transporteur et hors de
// tout verrou — exactement ce que le suivi partage interdit.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DeliveryProvider } from './provider'
import type { DeliveryIntegrationConfig, TrackParcelResult } from './types'
import type { DeliveryLogger } from './logger'
import { finalizeTrackedStatus, STATUS_DATE_FIELDS } from './apply-tracked-status'
import { isExchangeFollowUpOrder } from './exchange-providers'

type AdminClient = SupabaseClient<any, 'public', any>

const FINAL_ORDER_STATUSES = [
  'delivered',
  'returned_not_stocked',
  'returned_stocked',
  'refused',
  'confirmed',
  'cancelled',
]

async function loadOrderRow(admin: AdminClient, orderId: string, storeId: string) {
  const columns = [
    'id',
    'store_id',
    'status',
    'delivery_status',
    'delivery_status_source',
    'delivery_company_id',
    'exchange_status',
    'exchange_original_order_id',
    'updated_at',
    ...STATUS_DATE_FIELDS,
  ].join(', ')

  const { data, error } = await admin
    .from('orders')
    .select(columns)
    .eq('id', orderId)
    // Filtrage explicite : jamais de lecture hors store.
    .eq('store_id', storeId)
    .maybeSingle()

  if (error) throw error
  return data as (Record<string, unknown> & { id: string }) | null
}

/**
 * Track un colis et met a jour le statut de la commande.
 * `storeId` est OBLIGATOIRE : sans lui, la commande n'est pas lue.
 */
export async function trackAndUpdateOrder(params: {
  admin: AdminClient
  provider: DeliveryProvider
  config: DeliveryIntegrationConfig
  trackingNumber: string
  storeId: string
  orderId?: string
  logger: DeliveryLogger
}): Promise<TrackParcelResult> {
  const { admin, provider, config, trackingNumber, storeId, orderId, logger } = params

  const startTime = Date.now()
  const result = await provider.trackParcel(config, trackingNumber)
  const durationMs = Date.now() - startTime

  logger.info('track-complete', 'Tracking recupere', {
    trackingNumber,
    rawStatus: result.rawStatus,
    orderStatus: result.orderStatus,
    deliveryStatus: result.deliveryStatus,
    durationMs,
  })

  if (!orderId) return result

  const order = await loadOrderRow(admin, orderId, storeId)
  if (!order) {
    logger.warn('track-order-missing', 'Commande introuvable pour ce store', { orderId, storeId })
    return result
  }

  const deliveryCompanyId = String((order as Record<string, unknown>).delivery_company_id || '')

  const applied = await finalizeTrackedStatus({
    admin,
    storeId,
    provider: 'ozone',
    order: order as any,
    tracked: {
      rawStatus: result.rawStatus,
      orderStatus: result.orderStatus,
      deliveryStatus: result.deliveryStatus,
      statusDateField: result.statusDateField,
      eventAt: null,
      // Sans statut commande identifie, rien ne doit etre applique.
      recognized: Boolean(result.orderStatus || result.deliveryStatus),
    },
    terminalOrderStatuses: FINAL_ORDER_STATUSES,
    exchangeReturnStatus: 'returned_not_stocked',
    isExchangeFollowUp: isExchangeFollowUpOrder(order as any),
    // Suivi manuel d'un seul colis : aucun bail detenu (mode explicite).
    worker: `legacy-track:${provider.slug}`,
    trackingKey: trackingNumber,
    freshnessMs: 15 * 60 * 1000,
    trackingColumn: 'tracking_number',
    deliveryCompanyIds: deliveryCompanyId ? [deliveryCompanyId] : [],
    allowWithoutClaim: true,
  })

  logger.info('track-applied', 'Resultat du suivi', {
    orderId,
    outcome: applied.outcome,
    statusChanged: applied.statusChanged,
    deliveryChanged: applied.deliveryChanged,
    detail: applied.detail,
  })

  return result
}
