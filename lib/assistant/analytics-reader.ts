/** Contrat analytique V5 : aucun chiffre ne provient d'un scan PostgREST. */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnalyticsRange } from '@/lib/assistant/types'
import { addBusinessDays, businessDayStartUtc, businessRange, businessTodayIso, previousBusinessRange, type BusinessRange } from '@/lib/dashboard/business-time'
import { fetchDashboardKpiReader, hasFinancialTotals, KPI_READER_RPC_V2, type KpiReaderStore, type KpiReaderPayload } from '@/lib/dashboard/kpi-reader'

export type AnalyticsState = 'complete' | 'partial' | 'missing' | 'forbidden' | 'unavailable'
export type AnalyticsMetric = { value: string | number | null; state: AnalyticsState; numerator?: number; denominator?: number; definition: string; limit?: string }
export interface AnalyticsStoreResult {
  storeId: string
  currency: string
  timeZone: string
  access: 'full' | 'commercial'
  definitionVersion: number
  coverage: KpiReaderStore['coverage']
  revision: string
  lastRebuildAt: string | null
  metrics: Record<string, AnalyticsMetric>
  /** Journées métier publiées ; aucune journée n'est inventée. */
  days: Array<{
    date: string
    orders: number
    delivered: number
    revenue: string | null
    ads: string | null
    partial: boolean
  }>
}
export interface AnalyticsReaderResult {
  state: AnalyticsState
  range: BusinessRange
  source: 'rpc_dashboard_kpi_reader_v2'
  generatedAt: string | null
  stores: AnalyticsStoreResult[]
  limits: string[]
}

const DAY_MS = 86_400_000
function validDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const parsed = new Date(`${day}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day
}

/** Les plages absolues legacy sont des instants [start,end[ : conversion autorisée uniquement à minuit métier. */
export function resolveAssistantBusinessRange(range: AnalyticsRange, now = new Date()): BusinessRange {
  const today = businessTodayIso(now)
  if (typeof range === 'object') {
    if (validDay(range.start) && validDay(range.end)) return checked({ from: range.start, to: range.end })
    const start = new Date(range.start)
    const end = new Date(range.end)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw new Error('ANALYTICS_BAD_RANGE')
    // Les appels existants fournissent des ISO instantanés ; refuser toute borne ambiguë.
    const from = businessTodayIso(start)
    const to = businessTodayIso(end)
    if (businessDayStartUtc(from).getTime() !== start.getTime() || businessDayStartUtc(to).getTime() !== end.getTime()) {
      throw new Error('ANALYTICS_BAD_RANGE')
    }
    return checked({ from, to })
  }
  if (range === 'yesterday') return checked(businessRange('yesterday', null, null, now))
  if (range === 'month' || range === 'last_month') return checked(businessRange(range, null, null, now))
  const days = range === '7d' ? 7 : 30
  return checked({ from: addBusinessDays(today, 1 - days), to: addBusinessDays(today, 1) })
}

function checked(range: BusinessRange): BusinessRange {
  if (!validDay(range.from) || !validDay(range.to) || range.from >= range.to ||
      (Date.parse(range.to) - Date.parse(range.from)) / DAY_MS > 400) throw new Error('ANALYTICS_BAD_RANGE')
  return range
}

const metric = (value: string | number | null, state: AnalyticsState, definition: string, limit?: string): AnalyticsMetric => ({ value, state, definition, ...(limit ? { limit } : {}) })

function storeResult(store: KpiReaderStore): AnalyticsStoreResult {
  const state: AnalyticsState = store.incomplete || store.coverage.days_partial > 0 ? 'partial' : 'complete'
  const totals = store.totals
  const metrics: Record<string, AnalyticsMetric> = {
    orders: metric(totals.orders_count, state, 'V5: commandes sur la période métier (axe commande)'),
    delivered: metric(totals.delivered_count, state, 'V5: commandes livrées (axe commande)'),
    revenue: metric(totals.revenue, state, 'V5: CA réalisé, montant décimal exact'),
    revenueEstimated: metric(totals.revenue_estimated, state, 'V5: CA estimé, distinct du CA réalisé'),
    adSpend: metric(totals.ad_spend_contract, state, 'V5: publicité, couverture journalière + fallback contractuel'),
    returned: metric(totals.returned_count, state, 'V5: retours selon statuts canoniques'),
    cancelled: metric(totals.cancelled_count, state, 'V5: annulations selon statuts canoniques'),
  }
  metrics.deliveryRate = {
    ...metric(totals.orders_count ? totals.delivery_rate : null, totals.orders_count ? state : 'missing', 'V5: livrées / commandes (ceci n’est pas un taux de confirmation)'),
    numerator: totals.delivered_count, denominator: totals.orders_count,
  }
  if (hasFinancialTotals(store)) {
    metrics.purchaseCost = metric(store.totals.purchase_cost, state, 'V5: coût d’achat des commandes livrées')
    metrics.deliveryCost = metric(store.totals.delivery_fee_cost, state, 'V5: coût de livraison, axe commande')
    metrics.confirmationCost = metric(store.totals.confirmation_cost, state, 'V5: coût de confirmation')
    metrics.contributionMargin = metric(store.totals.contribution_margin, state, 'V5: marge contributive ; PAS résultat opérationnel')
  } else {
    for (const name of ['purchaseCost', 'deliveryCost', 'confirmationCost', 'contributionMargin']) {
      metrics[name] = metric(null, 'forbidden', 'V5: accès financier full requis')
    }
  }
  if (store.coverage.days_aggregate + store.coverage.days_direct === 0) {
    for (const item of Object.values(metrics)) if (item.state !== 'forbidden') { item.state = 'missing'; item.value = null }
  }
  const days = store.points.map((point) => ({
    date: point.date,
    orders: point.orders_count,
    delivered: point.delivered_count,
    revenue: point.revenue,
    ads: point.ads,
    partial: point.partial,
  }))
  return { storeId: store.store_id, currency: store.currency, timeZone: store.tz, access: store.access,
    definitionVersion: store.definition_version, coverage: store.coverage, revision: store.revision,
    lastRebuildAt: store.last_rebuild_at, metrics, days }
}

export async function readAssistantKpis(supabase: SupabaseClient, storeIds: string[], range: BusinessRange): Promise<AnalyticsReaderResult> {
  checked(range)
  if (!storeIds.length || storeIds.length > 5 || new Set(storeIds).size !== storeIds.length) throw new Error('ANALYTICS_BAD_SCOPE')
  try {
    const payload: KpiReaderPayload = await fetchDashboardKpiReader(supabase, {
      storeIds, from: range.from, to: range.to, includeDirect: false, rpc: KPI_READER_RPC_V2,
    })
    if (!payload || !Array.isArray(payload.stores) || payload.stores.length !== storeIds.length ||
        storeIds.some(id => !payload.stores.some(store => store.store_id === id))) throw new Error('ANALYTICS_INCOMPLETE_SCOPE')
    const stores = payload.stores.map(storeResult)
    const states = stores.flatMap(s => Object.values(s.metrics).map(m => m.state)).filter(s => s !== 'forbidden')
    return { state: states.every(s => s === 'missing') ? 'missing' : states.some(s => s === 'partial' || s === 'missing') ? 'partial' : 'complete',
      range, source: 'rpc_dashboard_kpi_reader_v2', generatedAt: payload.generated_at, stores,
      limits: ['Montants non additionnés entre devises.', 'Couverture absente/sale : pas de scan direct de secours.', 'Le résultat opérationnel requiert une RPC financière dédiée.'] }
  } catch (error) {
    if (error instanceof Error && (error.message.includes('KPI_NO_ACCESS') || error.message.includes('KPI_UNAUTHENTICATED'))) {
      return { state: 'forbidden', range, source: 'rpc_dashboard_kpi_reader_v2', generatedAt: null, stores: [], limits: ['Accès refusé par le lecteur V5.'] }
    }
    throw error
  }
}

export async function compareAssistantKpis(supabase: SupabaseClient, storeIds: string[], range: BusinessRange) {
  checked(range)
  const previous = checked(previousBusinessRange(range))
  const [current, baseline] = await Promise.all([
    readAssistantKpis(supabase, storeIds, range), readAssistantKpis(supabase, storeIds, previous),
  ])
  return { current, previous: baseline, limits: ['Comparaison : deux lectures V5 indépendantes ; aucune différence calculée si couverture ou devise incompatible.'] }
}

/**
 * Session analytique d'une requête : la lecture KPI V5 est mémorisée, donc
 * plusieurs outils partagent une seule lecture par période. Une session porte
 * un périmètre et une période immuables.
 */
export interface AssistantAnalyticsSession {
  supabase: SupabaseClient
  storeIds: string[]
  range: BusinessRange
  kpis: () => Promise<AnalyticsReaderResult>
}

export function createAssistantAnalyticsSession(
  supabase: SupabaseClient,
  storeIds: string[],
  range: BusinessRange,
): AssistantAnalyticsSession {
  checked(range)
  let pending: Promise<AnalyticsReaderResult> | null = null
  return {
    supabase,
    storeIds: [...storeIds],
    range,
    kpis: () => {
      if (!pending) pending = readAssistantKpis(supabase, storeIds, range)
      return pending
    },
  }
}

/**
 * Comparaison de deux périodes. Les deux lectures V5 sont indépendantes ; les
 * écarts ne sont calculés que si devise, couverture et accès sont compatibles.
 */
export async function compareAssistantPeriods(
  supabase: SupabaseClient,
  storeIds: string[],
  range: BusinessRange,
): Promise<{
  current: AnalyticsReaderResult
  previous: AnalyticsReaderResult
  deltas: Record<string, number | null>
  notices: string[]
}> {
  checked(range)
  const previousRange = checked(previousBusinessRange(range))
  const [current, previous] = await Promise.all([
    readAssistantKpis(supabase, storeIds, range),
    readAssistantKpis(supabase, storeIds, previousRange),
  ])

  const notices: string[] = []
  const deltas: Record<string, number | null> = {}
  const comparable =
    current.state !== 'forbidden' &&
    previous.state !== 'forbidden' &&
    current.stores.length === previous.stores.length &&
    new Set(current.stores.map((store) => store.currency)).size === 1 &&
    current.stores.every((store, index) => store.currency === previous.stores[index]?.currency)

  const sumOf = (result: AnalyticsReaderResult, name: string): number | null => {
    const values = result.stores.map((store) => store.metrics[name]?.value ?? null)
    if (values.length === 0 || values.some((value) => value === null)) return null
    return values.reduce<number>((acc, value) => acc + Number(value), 0)
  }

  if (!comparable) {
    notices.push('Périodes non comparables : périmètre, devise ou autorisation incompatibles. Aucun écart calculé.')
    for (const name of ['orders', 'delivered', 'revenue', 'adSpend', 'contributionMargin']) {
      deltas[name] = null
    }
  } else {
    for (const name of ['orders', 'delivered', 'adSpend', 'revenue', 'contributionMargin']) {
      const now = sumOf(current, name)
      const before = sumOf(previous, name)
      deltas[name] = now !== null && before !== null ? now - before : null
    }
    if (deltas.contributionMargin === null) {
      notices.push('Écart de marge non calculé : accès financier ou couverture insuffisants.')
    }
  }

  return { current, previous, deltas, notices }
}
