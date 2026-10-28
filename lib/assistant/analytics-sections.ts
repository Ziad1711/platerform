/**
 * Sections confirmation, agents et villes.
 *
 * Règles :
 * - réponses RPC validées à l'exécution (aucune ligne supposée conforme) ;
 * - agrégats exécutés en base, jamais recomposés depuis une liste plafonnée ;
 * - troncature détectée (nombre de groupes) ⇒ `partial`, jamais silencieuse ;
 * - montants en décimal exact, taux exacts, `null` à la place de tout faux zéro.
 */
import {
  allStoresFull,
  applyConsistency,
  authorizedStoreIds,
  baseMeta,
  check,
  forbidden,
  invalidPayload,
  singleCurrency,
  toDecimalText,
  toNumber,
  unavailable,
  v5Value,
  type SectionRequest,
  type SectionResult,
} from '@/lib/assistant/analytics-contract'
import { percentOfCounts, sumDecimals, compareDecimals } from '@/lib/assistant/analytics-decimal'
import {
  assertBusinessRange,
  exclusiveEndAsInclusiveMicrosecond,
  MAX_DETAIL_GROUPS,
  rangeInstants,
  SECTION_MAX_DAYS,
} from '@/lib/assistant/analytics-range'
import {
  AgentPerformanceRowSchema,
  CityPerformanceRowSchema,
  ConfirmationFunnelRowSchema,
  validateRows,
} from '@/lib/assistant/analytics-rpc-validation'

export interface ConfirmationRow {
  totalOrders: number
  confirmedOrders: number
  sentOrders: number
  waitingPickupOrders: number
  deliveredOrders: number
  returnedOrders: number
  cancelledOrders: number
  pendingOrders: number
  confirmationRate: string | null
}

/** Erreur de garde traduite en résultat explicite (jamais une exception nue). */
function guardFailure<Row>(
  section: string,
  source: string,
  kpis: SectionRequest['kpis'],
  error: unknown,
): SectionResult<Row> {
  const message = error instanceof Error ? error.message : 'ANALYTICS_UNKNOWN'
  if (message === 'ANALYTICS_RANGE_TOO_LARGE') {
    return unavailable(section, source, kpis, `Période trop large pour une analyse détaillée (maximum ${SECTION_MAX_DAYS} jours).`)
  }
  return unavailable(section, source, kpis, 'Période invalide : aucune lecture effectuée.')
}

/**
 * Tunnel de confirmation (`order_counts_as_confirmed`), bornes `[from, to[`.
 * Une période sans commande renvoie des zéros réels, pas une absence.
 */
export async function readConfirmationSection({ supabase, kpis }: SectionRequest): Promise<SectionResult<ConfirmationRow>> {
  const source = 'rpc_dashboard_confirmation_counters'
  if (kpis.state === 'forbidden') return forbidden('confirmation', source, kpis)
  const storeIds = authorizedStoreIds(kpis)
  if (storeIds.length === 0) return unavailable('confirmation', source, kpis, 'Aucune boutique autorisée.')

  try {
    assertBusinessRange(kpis.range, SECTION_MAX_DAYS)
  } catch (error) {
    return guardFailure('confirmation', source, kpis, error)
  }

  const { startUtc, endUtc } = rangeInstants(kpis.range)
  const { data, error } = await supabase.rpc(source, {
    p_store_ids: storeIds,
    p_start_date: startUtc,
    p_end_date: endUtc,
  })
  if (error) {
    if (error.message?.includes('NO_ACCESS')) return forbidden('confirmation', source, kpis)
    return unavailable('confirmation', source, kpis, 'Lecture du tunnel de confirmation indisponible.')
  }

  const validated = validateRows(ConfirmationFunnelRowSchema, Array.isArray(data) ? data : [data].filter(Boolean))
  if (!validated.ok) return invalidPayload('confirmation', source, kpis, validated.issues)
  if (validated.rows.length === 0) {
    return unavailable('confirmation', source, kpis, 'Aucune ligne retournée par la RPC de confirmation.')
  }

  const raw = validated.rows[0]
  const counts = {
    totalOrders: toNumber(raw.total_orders),
    confirmedOrders: toNumber(raw.confirmed_orders),
    sentOrders: toNumber(raw.sent_orders),
    waitingPickupOrders: toNumber(raw.waiting_pickup_orders),
    deliveredOrders: toNumber(raw.delivered_orders),
    returnedOrders: toNumber(raw.returned_orders),
    cancelledOrders: toNumber(raw.cancelled_orders),
    pendingOrders: toNumber(raw.pending_orders),
  }

  const unconvertible = Object.entries(counts)
    .filter(([, value]) => value === null)
    .map(([name]) => name)
  if (unconvertible.length > 0) {
    return invalidPayload('confirmation', source, kpis, [
      `Compteurs non entiers ou illisibles : ${unconvertible.join(', ')}.`,
    ])
  }

  const totalOrders = counts.totalOrders as number
  const confirmedOrders = counts.confirmedOrders as number

  const row: ConfirmationRow = {
    totalOrders,
    confirmedOrders,
    sentOrders: counts.sentOrders as number,
    waitingPickupOrders: counts.waitingPickupOrders as number,
    deliveredOrders: counts.deliveredOrders as number,
    returnedOrders: counts.returnedOrders as number,
    cancelledOrders: counts.cancelledOrders as number,
    pendingOrders: counts.pendingOrders as number,
    confirmationRate: percentOfCounts(confirmedOrders, totalOrders),
  }

  const meta = baseMeta('confirmation', source, kpis, totalOrders === 0 ? 'empty' : 'complete')
  meta.limits.push('Confirmation ≠ livraison : le taux porte sur les commandes confirmées.')
  applyConsistency(meta, [
    check('orders', v5Value(kpis, 'orders'), String(row.totalOrders)),
    check('delivered', v5Value(kpis, 'delivered'), String(row.deliveredOrders)),
    check('returned', v5Value(kpis, 'returned'), String(row.returnedOrders)),
    check('cancelled', v5Value(kpis, 'cancelled'), String(row.cancelledOrders)),
  ])

  return {
    meta,
    rows: [row],
    totals: {
      totalOrders: row.totalOrders,
      confirmedOrders: row.confirmedOrders,
      confirmationRate: row.confirmationRate,
    },
  }
}

export interface AgentPerformanceRow {
  agentId: string | null
  agentName: string
  totalOrders: number
  confirmedOrders: number
  deliveredOrders: number
  rejectedOrders: number
  confirmationRate: string | null
  /** Absent hors accès financier `full` : jamais renvoyé à un profil commercial. */
  commission?: { potential: string | null; earned: string | null; paid: string | null }
}

/**
 * Performance par agent.
 *
 * - borne haute historique inclusive (`<=`) : on passe la dernière microseconde
 *   de la période `[from, to[` (`exclusiveEndAsInclusiveMicrosecond`) ;
 * - troncature détectée par une lecture de `MAX_DETAIL_GROUPS + 1` lignes ;
 * - commissions publiées uniquement si toutes les boutiques sont `full`.
 */
export async function readAgentSection({ supabase, kpis }: SectionRequest): Promise<SectionResult<AgentPerformanceRow>> {
  const source = 'rpc_dashboard_confirmation_performance'
  if (kpis.state === 'forbidden') return forbidden('agents', source, kpis)
  const storeIds = authorizedStoreIds(kpis)
  if (storeIds.length === 0) return unavailable('agents', source, kpis, 'Aucune boutique autorisée.')

  try {
    assertBusinessRange(kpis.range, SECTION_MAX_DAYS)
  } catch (error) {
    return guardFailure('agents', source, kpis, error)
  }

  const { startUtc, endUtc } = rangeInstants(kpis.range)
  const inclusiveEnd = exclusiveEndAsInclusiveMicrosecond(endUtc)

  const { data, error } = await supabase
    .rpc(source, { p_store_ids: storeIds, p_start_date: startUtc, p_end_date: inclusiveEnd })
    .limit(MAX_DETAIL_GROUPS + 1)
  if (error) {
    if (error.message?.includes('NO_ACCESS')) return forbidden('agents', source, kpis)
    return unavailable('agents', source, kpis, 'Lecture de la performance agent indisponible.')
  }

  const validated = validateRows(AgentPerformanceRowSchema, data)
  if (!validated.ok) return invalidPayload('agents', source, kpis, validated.issues)

  const truncated = validated.rows.length > MAX_DETAIL_GROUPS
  const rawRows = truncated ? validated.rows.slice(0, MAX_DETAIL_GROUPS) : validated.rows
  const canSeeMoney = allStoresFull(kpis)

  const mapped: AgentPerformanceRow[] = []
  let malformed = 0
  for (const row of rawRows) {
    const totalOrders = toNumber(row.total_orders)
    const confirmedOrders = toNumber(row.confirmed_orders)
    const deliveredOrders = toNumber(row.delivered_orders)
    const rejectedOrders = toNumber(row.rejected_orders)

    if (totalOrders === null || confirmedOrders === null || deliveredOrders === null || rejectedOrders === null) {
      malformed += 1
      continue
    }

    const entry: AgentPerformanceRow = {
      agentId: row.agent_id,
      agentName: row.agent_name ?? 'Agent sans nom',
      totalOrders,
      confirmedOrders,
      deliveredOrders,
      rejectedOrders,
      confirmationRate: percentOfCounts(confirmedOrders, totalOrders),
    }
    if (canSeeMoney) {
      entry.commission = {
        potential: toDecimalText(row.potential_commission),
        earned: toDecimalText(row.earned_commission),
        paid: toDecimalText(row.paid_commission),
      }
    }
    mapped.push(entry)
  }

  const meta = baseMeta('agents', source, kpis, mapped.length === 0 ? 'empty' : truncated ? 'partial' : 'complete')
  meta.limits.push('Regroupement par identifiant d’agent ; commandes sans agent exclues.')
  if (truncated) meta.notices.push(`Plus de ${MAX_DETAIL_GROUPS} agents : liste tronquée, totaux non représentatifs.`)
  if (malformed > 0) {
    if (meta.state === 'complete') meta.state = 'partial'
    meta.issues.push(`AGENT_ROWS_UNPARSABLE:${malformed}`)
    meta.notices.push(`${malformed} ligne(s) d’agent illisible(s) exclue(s) : totaux partiels.`)
  }
  if (!canSeeMoney) meta.notices.push('Commissions masquées : accès financier `full` requis sur toutes les boutiques.')
  meta.notices.push('Une baisse concentrée sur un agent est une association observée, pas une preuve de causalité.')

  const totalOrders = mapped.reduce((sum, row) => sum + row.totalOrders, 0)
  const confirmedOrders = mapped.reduce((sum, row) => sum + row.confirmedOrders, 0)
  const v5Orders = v5Value(kpis, 'orders')

  if (!truncated) {
    // Les agents ne couvrent qu'un sous-ensemble du périmètre : une égalité
    // n'est pas attendue, seule une supériorité est incohérente.
    const excess = v5Orders !== null && compareDecimals(String(totalOrders), v5Orders) === 1
    meta.consistency = [
      {
        metric: 'agents.assigned_orders',
        v5: v5Orders,
        section: String(totalOrders),
        match: excess ? false : null,
        reason: excess ? 'EXCEEDS_SCOPE' : 'SUBSET_EXPECTED',
      },
    ]
    if (excess) {
      if (meta.state === 'complete') meta.state = 'partial'
      meta.notices.push('Les agents totalisent plus de commandes que le périmètre V5 : incohérence signalée.')
    }
  }

  return {
    meta,
    rows: mapped,
    totals: {
      totalOrders,
      confirmedOrders,
      confirmationRate: percentOfCounts(confirmedOrders, totalOrders),
    },
  }
}


export interface CityPerformanceRow {
  city: string
  totalOrders: number
  confirmedOrders: number
  deliveredOrders: number
  returnedOrders: number
  cancelledOrders: number
  /** CA exact des lignes livrées ; jamais additionné entre boutiques devises. */
  revenue: string | null
  confirmationRate: string | null
  deliveryRate: string | null
}

/**
 * Performance par ville : RPC agrégée en base, bornes `[from, to[`, une seule
 * devise exigée (la RPC ne renvoie pas `store_id`, donc aucune fusion
 * inter-boutiques devises ne peut être garantie).
 */
export async function readCitySection({ supabase, kpis }: SectionRequest): Promise<SectionResult<CityPerformanceRow>> {
  const source = 'rpc_dashboard_city_performance'
  if (kpis.state === 'forbidden') return forbidden('cities', source, kpis)
  const storeIds = authorizedStoreIds(kpis)
  if (storeIds.length === 0) return unavailable('cities', source, kpis, 'Aucune boutique autorisée.')
  if (!singleCurrency(kpis)) {
    return unavailable('cities', source, kpis, 'Périmètre multidevise : aucune agrégation de CA par ville.')
  }

  try {
    assertBusinessRange(kpis.range, SECTION_MAX_DAYS)
  } catch (error) {
    return guardFailure('cities', source, kpis, error)
  }

  const { startUtc, endUtc } = rangeInstants(kpis.range)
  const { data, error } = await supabase
    .rpc(source, { p_store_ids: storeIds, p_start_date: startUtc, p_end_date: endUtc })
    .limit(MAX_DETAIL_GROUPS + 1)
  if (error) {
    if (error.message?.includes('NO_ACCESS')) return forbidden('cities', source, kpis)
    return unavailable('cities', source, kpis, 'Lecture de la performance par ville indisponible.')
  }

  const validated = validateRows(CityPerformanceRowSchema, data)
  if (!validated.ok) return invalidPayload('cities', source, kpis, validated.issues)

  const truncated = validated.rows.length > MAX_DETAIL_GROUPS
  const rawRows = truncated ? validated.rows.slice(0, MAX_DETAIL_GROUPS) : validated.rows

  const mapped: CityPerformanceRow[] = []
  let malformed = 0
  for (const row of rawRows) {
    const totalOrders = toNumber(row.total_orders)
    const confirmedOrders = toNumber(row.confirmed_orders)
    const deliveredOrders = toNumber(row.delivered_orders)
    const returnedOrders = toNumber(row.returned_orders)
    const cancelledOrders = toNumber(row.cancelled_orders)

    if (
      totalOrders === null || confirmedOrders === null || deliveredOrders === null ||
      returnedOrders === null || cancelledOrders === null
    ) {
      malformed += 1
      continue
    }

    mapped.push({
      city: row.city ?? 'Ville non renseignée',
      totalOrders,
      confirmedOrders,
      deliveredOrders,
      returnedOrders,
      cancelledOrders,
      revenue: toDecimalText(row.total_revenue),
      confirmationRate: percentOfCounts(confirmedOrders, totalOrders),
      deliveryRate: percentOfCounts(deliveredOrders, totalOrders),
    })
  }

  const meta = baseMeta('cities', source, kpis, mapped.length === 0 ? 'empty' : truncated ? 'partial' : 'complete')
  meta.limits.push('CA par ville = lignes des commandes livrées ; aucune marge ni coût.')
  if (truncated) meta.notices.push(`Plus de ${MAX_DETAIL_GROUPS} villes : liste tronquée, totaux non représentatifs.`)
  if (malformed > 0) {
    if (meta.state === 'complete') meta.state = 'partial'
    meta.issues.push(`CITY_ROWS_UNPARSABLE:${malformed}`)
    meta.notices.push(`${malformed} ligne(s) de ville illisible(s) exclue(s) : totaux partiels.`)
  }
  if (mapped.some((row) => row.city === 'Ville non renseignée')) {
    meta.notices.push('Des commandes sans ville sont regroupées à part.')
  }

  const orders = mapped.reduce((sum, row) => sum + row.totalOrders, 0)
  const delivered = mapped.reduce((sum, row) => sum + row.deliveredOrders, 0)
  const revenue = truncated ? null : sumDecimals(mapped.map((row) => row.revenue))

  if (!truncated) {
    applyConsistency(meta, [
      check('cities.orders', v5Value(kpis, 'orders'), String(orders)),
      check('cities.delivered', v5Value(kpis, 'delivered'), String(delivered)),
      check('cities.revenue', v5Value(kpis, 'revenue'), revenue),
    ])
  }

  return {
    meta,
    rows: mapped,
    totals: {
      orders,
      delivered,
      revenue,
      confirmationRate: percentOfCounts(
        mapped.reduce((sum, row) => sum + row.confirmedOrders, 0),
        orders,
      ),
    },
  }
}
