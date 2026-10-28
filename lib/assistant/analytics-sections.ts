/**
 * Sections analytiques détaillées : confirmation, agents, villes.
 *
 * Règles : lecture KPI V5 unique pour le périmètre et les devises, agrégats
 * exécutés en base, états explicites, contrôles de cohérence avec V5, aucun
 * montant additionné entre devises distinctes et aucun zéro inventé.
 */
import {
  allStoresFull,
  applyConsistency,
  authorizedStoreIds,
  baseMeta,
  check,
  forbidden,
  instants,
  singleCurrency,
  toDecimalText,
  toNumber,
  unavailable,
  v5Metric,
  type SectionRequest,
  type SectionResult,
} from '@/lib/assistant/analytics-contract'

interface FunnelRow {
  total_orders: number | string | null
  confirmed_orders: number | string | null
  sent_orders: number | string | null
  waiting_pickup_orders: number | string | null
  delivered_orders: number | string | null
  returned_orders: number | string | null
  cancelled_orders: number | string | null
  pending_orders: number | string | null
}

export interface ConfirmationRow {
  totalOrders: number
  confirmedOrders: number
  sentOrders: number
  waitingPickupOrders: number
  deliveredOrders: number
  returnedOrders: number
  cancelledOrders: number
  pendingOrders: number
  confirmationRate: number | null
}

/**
 * Tunnel de confirmation : `rpc_dashboard_confirmation_counters` applique la
 * définition métier unique `order_counts_as_confirmed` (progression logistique).
 * Une période sans commande renvoie une ligne de zéros réels, pas une absence.
 */
export async function readConfirmationSection({
  supabase,
  kpis,
}: SectionRequest): Promise<SectionResult<ConfirmationRow>> {
  const source = 'rpc_dashboard_confirmation_counters'
  if (kpis.state === 'forbidden') return forbidden('confirmation', source, kpis)
  const storeIds = authorizedStoreIds(kpis)
  if (storeIds.length === 0) {
    return unavailable('confirmation', source, kpis, 'Aucune boutique autorisée dans le périmètre.')
  }

  const { startUtc, endUtc } = instants(kpis.range)
  const { data, error } = await supabase.rpc(source, {
    p_store_ids: storeIds,
    p_start_date: startUtc,
    p_end_date: endUtc,
  })
  if (error) {
    if (error.message?.includes('NO_ACCESS')) return forbidden('confirmation', source, kpis)
    return unavailable('confirmation', source, kpis, 'Lecture du tunnel de confirmation indisponible.')
  }

  const raw = (Array.isArray(data) ? data[0] : data) as FunnelRow | null | undefined
  if (!raw) {
    return unavailable('confirmation', source, kpis, 'Aucune ligne retournée par la RPC de confirmation.')
  }

  const totalOrders = toNumber(raw.total_orders)
  const confirmedOrders = toNumber(raw.confirmed_orders)
  if (totalOrders === null || confirmedOrders === null) {
    return unavailable('confirmation', source, kpis, 'Compteurs de confirmation illisibles.')
  }

  const row: ConfirmationRow = {
    totalOrders,
    confirmedOrders,
    sentOrders: toNumber(raw.sent_orders) ?? 0,
    waitingPickupOrders: toNumber(raw.waiting_pickup_orders) ?? 0,
    deliveredOrders: toNumber(raw.delivered_orders) ?? 0,
    returnedOrders: toNumber(raw.returned_orders) ?? 0,
    cancelledOrders: toNumber(raw.cancelled_orders) ?? 0,
    pendingOrders: toNumber(raw.pending_orders) ?? 0,
    confirmationRate: totalOrders > 0 ? (confirmedOrders / totalOrders) * 100 : null,
  }

  const meta = baseMeta('confirmation', source, kpis, totalOrders === 0 ? 'empty' : 'complete')
  meta.limits.push('Confirmation ≠ livraison : le taux porte sur les commandes confirmées, non livrées.')
  applyConsistency(meta, [
    check('orders', v5Metric(kpis, 'orders'), row.totalOrders),
    check('delivered', v5Metric(kpis, 'delivered'), row.deliveredOrders),
    check('returned', v5Metric(kpis, 'returned'), row.returnedOrders),
    check('cancelled', v5Metric(kpis, 'cancelled'), row.cancelledOrders),
  ])

  return {
    meta,
    rows: [row],
    totals: { totalOrders, confirmedOrders, confirmationRate: row.confirmationRate },
  }
}


interface AgentRow {
  agent_id: string | null
  agent_name: string | null
  total_orders: number | string | null
  confirmed_orders: number | string | null
  delivered_orders: number | string | null
  rejected_orders: number | string | null
  potential_commission: string | number | null
  earned_commission: string | number | null
  paid_commission: string | number | null
}

export interface AgentPerformanceRow {
  agentId: string | null
  agentName: string
  totalOrders: number
  confirmedOrders: number
  deliveredOrders: number
  rejectedOrders: number
  confirmationRate: number | null
  /** Absent pour un accès `commercial` : jamais renvoyé à un profil non financier. */
  commission?: { potential: string | null; earned: string | null; paid: string | null }
}

/**
 * Performance par agent. La RPC historique expose aussi des commissions : elles
 * ne sont conservées que si toutes les boutiques du périmètre sont en accès
 * `full`, sinon le champ est supprimé avant réponse. La borne haute de cette
 * RPC est inclusive (`<=`) : elle reçoit `endUtc - 1 ms` pour respecter
 * le contrat métier `[from, to[`.
 */
export async function readAgentSection({ supabase, kpis }: SectionRequest): Promise<SectionResult<AgentPerformanceRow>> {
  const source = 'rpc_dashboard_confirmation_performance'
  if (kpis.state === 'forbidden') return forbidden('agents', source, kpis)
  const storeIds = authorizedStoreIds(kpis)
  if (storeIds.length === 0) return unavailable('agents', source, kpis, 'Aucune boutique autorisée dans le périmètre.')

  const { startUtc, endUtc } = instants(kpis.range)
  const inclusiveEnd = new Date(new Date(endUtc).getTime() - 1).toISOString()
  const { data, error } = await supabase.rpc(source, {
    p_store_ids: storeIds,
    p_start_date: startUtc,
    p_end_date: inclusiveEnd,
  })
  if (error) {
    if (error.message?.includes('NO_ACCESS')) return forbidden('agents', source, kpis)
    return unavailable('agents', source, kpis, 'Lecture de la performance agent indisponible.')
  }

  const rows = (Array.isArray(data) ? data : []) as AgentRow[]
  const canSeeMoney = allStoresFull(kpis)
  const mapped: AgentPerformanceRow[] = rows.map((row) => {
    const totalOrders = toNumber(row.total_orders) ?? 0
    const confirmedOrders = toNumber(row.confirmed_orders) ?? 0
    const entry: AgentPerformanceRow = {
      agentId: row.agent_id ?? null,
      agentName: row.agent_name ?? 'Agent non nommé',
      totalOrders,
      confirmedOrders,
      deliveredOrders: toNumber(row.delivered_orders) ?? 0,
      rejectedOrders: toNumber(row.rejected_orders) ?? 0,
      confirmationRate: totalOrders > 0 ? (confirmedOrders / totalOrders) * 100 : null,
    }
    if (canSeeMoney) {
      entry.commission = {
        potential: toDecimalText(row.potential_commission),
        earned: toDecimalText(row.earned_commission),
        paid: toDecimalText(row.paid_commission),
      }
    }
    return entry
  })

  const meta = baseMeta('agents', source, kpis, mapped.length === 0 ? 'empty' : 'complete')
  meta.limits.push('Regroupement par identifiant d’agent ; les commandes sans agent affecté sont exclues.')
  if (!canSeeMoney) meta.notices.push('Commissions masquées : accès financier `full` requis sur toutes les boutiques.')
  meta.notices.push('Une baisse concentrée sur un agent est une association observée, pas une preuve de causalité.')
  const totals = mapped.reduce(
    (sum, row) => ({
      totalOrders: sum.totalOrders + row.totalOrders,
      confirmedOrders: sum.confirmedOrders + row.confirmedOrders,
    }),
    { totalOrders: 0, confirmedOrders: 0 },
  )

  return {
    meta,
    rows: mapped,
    totals: {
      ...totals,
      confirmationRate: totals.totalOrders > 0 ? (totals.confirmedOrders / totals.totalOrders) * 100 : null,
    },
  }
}


interface CityRow {
  city: string | null
  total_orders: number | string | null
  confirmed_orders: number | string | null
  delivered_orders: number | string | null
  returned_orders: number | string | null
  cancelled_orders: number | string | null
  total_revenue: string | number | null
}

export interface CityPerformanceRow {
  city: string
  totalOrders: number
  confirmedOrders: number
  deliveredOrders: number
  returnedOrders: number
  cancelledOrders: number
  revenue: string | null
  confirmationRate: number | null
  deliveryRate: number | null
}

/**
 * Villes : `rpc_dashboard_city_performance` agrège déjà les lignes des commandes
 * livrées et applique `order_counts_as_confirmed`. La RPC ne renvoie pas le
 * `store_id` : le résultat n'est exposé que si le périmètre est mono-devise.
 */
export async function readCitySection({ supabase, kpis }: SectionRequest): Promise<SectionResult<CityPerformanceRow>> {
  const source = 'rpc_dashboard_city_performance'
  if (kpis.state === 'forbidden') return forbidden('cities', source, kpis)
  const storeIds = authorizedStoreIds(kpis)
  if (storeIds.length === 0) return unavailable('cities', source, kpis, 'Aucune boutique autorisée dans le périmètre.')
  const currency = singleCurrency(kpis)
  if (!currency) {
    return unavailable('cities', source, kpis, 'Périmètre multidevise : aucune somme de CA par ville n’est présentée.')
  }

  const { startUtc, endUtc } = instants(kpis.range)
  const { data, error } = await supabase.rpc(source, {
    p_store_ids: storeIds,
    p_start_date: startUtc,
    p_end_date: endUtc,
  })
  if (error) {
    if (error.message?.includes('NO_ACCESS')) return forbidden('cities', source, kpis)
    return unavailable('cities', source, kpis, 'Lecture de la performance par ville indisponible.')
  }

  const rows = (Array.isArray(data) ? data : []) as CityRow[]
  const mapped: CityPerformanceRow[] = rows.map((row) => {
    const totalOrders = toNumber(row.total_orders) ?? 0
    const confirmedOrders = toNumber(row.confirmed_orders) ?? 0
    const deliveredOrders = toNumber(row.delivered_orders) ?? 0
    return {
      city: row.city ?? 'Ville non renseignée',
      totalOrders,
      confirmedOrders,
      deliveredOrders,
      returnedOrders: toNumber(row.returned_orders) ?? 0,
      cancelledOrders: toNumber(row.cancelled_orders) ?? 0,
      revenue: toDecimalText(row.total_revenue),
      confirmationRate: totalOrders > 0 ? (confirmedOrders / totalOrders) * 100 : null,
      deliveryRate: totalOrders > 0 ? (deliveredOrders / totalOrders) * 100 : null,
    }
  })

  const meta = baseMeta('cities', source, kpis, mapped.length === 0 ? 'empty' : 'complete')
  meta.limits.push('CA par ville = lignes des commandes livrées ; aucune marge ni coût n’est calculé ici.')
  applyConsistency(meta, [
    check(
      'cities.orders',
      v5Metric(kpis, 'orders'),
      mapped.reduce((sum, row) => sum + row.totalOrders, 0),
    ),
  ])
  if (mapped.some((row) => row.city === 'Ville non renseignée')) {
    meta.notices.push('Des commandes sans ville sont regroupées à part, jamais réparties arbitrairement.')
  }

  return {
    meta,
    rows: mapped,
    totals: {
      orders: mapped.reduce((sum, row) => sum + row.totalOrders, 0),
      delivered: mapped.reduce((sum, row) => sum + row.deliveredOrders, 0),
      currency,
    },
  }
}
