// ============================================================
// Constantes d'échange de colis (sans dépendance serveur)
// Partageable entre l'API et les composants client.
// ============================================================

export type ExchangeProviderSlug = 'rapid-delivery' | 'maroc-go-delivery'

export const EXCHANGE_SUPPORTED_PROVIDERS: ExchangeProviderSlug[] = [
  'rapid-delivery',
  'maroc-go-delivery',
]

export function isExchangeSupportedProvider(value: unknown): value is ExchangeProviderSlug {
  return EXCHANGE_SUPPORTED_PROVIDERS.includes(String(value || '').trim() as ExchangeProviderSlug)
}

// Page « colis livrés » de chaque transporteur : c'est de là que part la
// demande d'échange manuelle (3 points sur la ligne du colis).
const CARRIER_DELIVERED_PARCELS_PAGES: Record<ExchangeProviderSlug, string> = {
  'rapid-delivery': 'https://www.rapiddelivery.ma/compte/colis-livres',
  'maroc-go-delivery': 'https://www.marocgodelivery.com/compte/colis-livres',
}

export function getExchangeCarrierPageUrl(providerSlug: ExchangeProviderSlug) {
  return CARRIER_DELIVERED_PARCELS_PAGES[providerSlug]
}

export const EXCHANGE_STATUS_REQUESTED = 'requested'
export const EXCHANGE_STATUS_LINKED = 'linked'
export const EXCHANGE_STATUS_COMPLETED = 'completed'
export const EXCHANGE_STATUS_CANCELLED = 'cancelled'

// La commande d'origine n'est suivie que tant que le transporteur n'a pas
// confirmé le retour (état « Retour/Echange »), afin de ne pas interroger
// indéfiniment l'API de suivi.
export const EXCHANGE_ACTIVE_STATUSES = [EXCHANGE_STATUS_REQUESTED, EXCHANGE_STATUS_LINKED]

export function isExchangeActive(exchangeStatus: unknown) {
  return EXCHANGE_ACTIVE_STATUSES.includes(String(exchangeStatus || '').trim())
}

export type ExchangeTrackableOrder = {
  status?: string | null
  exchange_status?: string | null
  exchange_original_order_id?: string | null
}

/**
 * Détermine si une commande doit rester suivie malgré un statut habituellement
 * exclu de la synchronisation :
 * - commande d'origine avec un échange encore actif ;
 * - commande de remplacement créée pour un échange, dont le colis existe déjà
 *   chez le transporteur avant même son expédition.
 */
export function isExchangeFollowUpOrder(order: ExchangeTrackableOrder | null | undefined) {
  if (!order) return false
  if (isExchangeActive(order.exchange_status)) return true
  return Boolean(order.exchange_original_order_id) && String(order.status || '') === 'confirmed'
}

// L'état « Retour/Echange » (id 17) des deux transporteurs est normalisé par
// mapRapidDeliveryStateToOrderStatus / mapMarocGoDeliveryStateToOrderStatus
// en « returned_not_stocked » : c'est le statut attendu côté ancien colis.
export const EXCHANGE_RETURN_ORDER_STATUS = 'returned_not_stocked'
