/**
 * Statuts de commande canoniques (source : migration
 * `20261025120000_kpi_dashboard_delivery_confirmation_period.sql`,
 * fonction SQL `order_counts_as_confirmed`).
 *
 * Ces listes existent pour éviter toute divergence entre le calcul applicatif et
 * la définition métier en base. Ne pas y ajouter un statut sans migration
 * correspondante.
 */
const CONFIRMED_AFTER_LOGISTICS = new Set([
  'picked_up',
  'sent',
  'delivered',
  'returned_stocked',
  'returned_not_stocked',
  'dl_pickup_pending',
  'dl_no_answer',
  'dl_unreachable',
  'dl_out_of_zone',
  'dl_client_interested',
  'dl_postponed',
  'dl_address_change',
  'dl_refund',
  'dl_follow_up_request',
  'dl_billing_error',
  'dl_out_for_delivery',
])

export const RETURNED_STATUSES = ['returned_stocked', 'returned_not_stocked'] as const
export const SENT_STATUSES = ['sent', 'delivered', 'returned_stocked', 'returned_not_stocked'] as const

/** Miroir exact de `public.order_counts_as_confirmed(status, confirmed_at)`. */
export function countsAsConfirmed(status: string | null, confirmedAt: string | null): boolean {
  if (!status) return false
  if (status === 'cancelled') return false
  if (status === 'confirmed') return true
  if (CONFIRMED_AFTER_LOGISTICS.has(status)) return true
  if (status === 'refused') return confirmedAt !== null
  return false
}

export function isReturned(status: string | null): boolean {
  return status === 'returned_stocked' || status === 'returned_not_stocked'
}

/** Commandes sorties du magasin (client ou transporteur), hors simple confirmation. */
export function isInTransit(status: string | null, deliveryStatus: string | null): boolean {
  if (status === 'sent' || status === 'dl_out_for_delivery') return true
  return deliveryStatus === 'in_transit' || deliveryStatus === 'out_for_delivery'
}
