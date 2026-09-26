import { CONFIRMATION_PENDING_STATUSES } from './constants'
import type { ConfirmationQueueFilter, ConfirmationSortOrder } from './types'

/** Champs strictement nécessaires au travail de confirmation (aucune donnée de marge). */
export const CONFIRMATION_ORDER_SELECT = `
  id, store_id, customer_name, phone, city, address, status, order_date,
  total_selling_price, delivery_charge_to_customer, delivery_company_id, tracking_number,
  delivery_note,
  confirmation_attempt_count, next_callback_at, confirmation_last_action_at,
  cancellation_reason_code, cancellation_note,
  confirmation_agent_id, confirmation_agents(name),
  confirmation_assigned_at, confirmation_assignment_source,
  delivery_companies(name),
  order_items(product_id, product_variant_id, quantity, unit_selling_price, product_name_override, products(name, product_images(image_url, is_primary, sort_order)))
`

export const CONFIRMATION_FILTERS: ConfirmationQueueFilter[] = [
  'to_process',
  'to_callback',
  'late',
  'confirmed',
  'cancelled',
  'all',
]

export const PENDING_STATUS_LIST: string[] = [...CONFIRMATION_PENDING_STATUSES]

export function isPendingStatus(status: string | null | undefined) {
  return PENDING_STATUS_LIST.includes(String(status || ''))
}

export function normalizeQueueFilter(value: string | null | undefined): ConfirmationQueueFilter {
  const candidate = String(value || '').trim() as ConfirmationQueueFilter
  return CONFIRMATION_FILTERS.includes(candidate) ? candidate : 'to_process'
}

/** Le tri par rappel n'a de sens que sur les files qui ont un rappel programmé. */
export function isCallbackSortAvailable(filter: ConfirmationQueueFilter) {
  return filter === 'to_callback' || filter === 'late'
}

export function getSortOptions(filter: ConfirmationQueueFilter) {
  const options: { value: ConfirmationSortOrder; label: string }[] = [
    { value: 'recent', label: 'Plus récentes' },
    { value: 'oldest', label: 'Plus anciennes' },
  ]

  if (isCallbackSortAvailable(filter)) {
    options.push({ value: 'callback', label: 'Rappel le plus proche' })
  }

  return options
}

export function normalizeSortOrder(
  value: string | null | undefined,
  filter: ConfirmationQueueFilter
): ConfirmationSortOrder {
  const candidate = String(value || '').trim() as ConfirmationSortOrder

  if (candidate === 'oldest') return 'oldest'
  if (candidate === 'callback' && isCallbackSortAvailable(filter)) return 'callback'
  return 'recent'
}

/**
 * Applique le périmètre d'une file de travail.
 * `nowIso` est calculé côté serveur pour rester cohérent avec les dates stockées.
 */
export function applyQueueFilter(query: any, filter: ConfirmationQueueFilter, nowIso: string) {
  switch (filter) {
    case 'to_process':
      return query.in('status', PENDING_STATUS_LIST).is('next_callback_at', null)
    case 'to_callback':
      return query.in('status', PENDING_STATUS_LIST).gte('next_callback_at', nowIso)
    case 'late':
      return query.in('status', PENDING_STATUS_LIST).lt('next_callback_at', nowIso)
    case 'confirmed':
      return query.eq('status', 'confirmed')
    case 'cancelled':
      return query.eq('status', 'cancelled')
    default:
      return query
  }
}

/** Le tri par défaut est « plus récentes d'abord ». */
export function applyQueueOrder(
  query: any,
  filter: ConfirmationQueueFilter,
  sort: ConfirmationSortOrder = 'recent'
) {
  if (sort === 'callback' && isCallbackSortAvailable(filter)) {
    // Rappel le plus proche en premier, puis la commande la plus récente.
    return query
      .order('next_callback_at', { ascending: true })
      .order('order_date', { ascending: false })
  }

  // Second tri stable (id) : indispensable pour une pagination déterministe.
  return query
    .order('order_date', { ascending: sort === 'oldest' })
    .order('id', { ascending: true })
}
