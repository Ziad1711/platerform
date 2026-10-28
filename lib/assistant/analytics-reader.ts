/**
 * Lecteur KPI V5 du chatbot (contrat versionné `ANALYTICS_CONTRACT_VERSION`).
 *
 * Règles :
 * - aucune valeur ne provient d'un scan PostgREST : seule la RPC V5 est lue ;
 * - payload validé à l'exécution (zod) avant toute interprétation ;
 * - montants conservés en décimal exact, jamais convertis en `number` ;
 * - états explicites, zéro réel distingué de l'absence de donnée ;
 * - une seule lecture V5 par session, partageable entre outils.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchDashboardKpiReader,
  hasFinancialTotals,
  KPI_READER_RPC_V2,
  type KpiReaderStore,
} from '@/lib/dashboard/kpi-reader'
import { previousBusinessRange, type BusinessRange } from '@/lib/dashboard/business-time'
import { percentOfCounts, subtractDecimals, sumDecimals, toDecimalText } from '@/lib/assistant/analytics-decimal'
import {
  ANALYTICS_CONTRACT_VERSION,
  COMPARABLE_METRICS,
  KPI_METRIC_ALIASES,
  aggregateMetric,
  type AnalyticsCoverage,
  type AnalyticsMetric,
  type AnalyticsReaderResult,
  type AnalyticsState,
  type AnalyticsStoreResult,
  type AssistantAnalyticsSession,
  type ComparableMetric,
  type KpiEnvelope,
  type KpiMetricAlias,
  type MetricDelta,
  type PeriodComparison,
  type StoreComparison,
  type StoreComparisonEntry,
} from '@/lib/assistant/analytics-contract'
import { assertBusinessRange, MAX_SCOPE_STORES } from '@/lib/assistant/analytics-range'
import { validateKpiPayload } from '@/lib/assistant/analytics-rpc-validation'

export type { AnalyticsReaderResult, AssistantAnalyticsSession } from '@/lib/assistant/analytics-contract'
export { resolveAssistantBusinessRange } from '@/lib/assistant/analytics-range'

function scopedState(store: KpiReaderStore): AnalyticsState {
  const covered = store.coverage.days_aggregate + store.coverage.days_direct
  if (covered === 0) return 'missing'
  if (store.incomplete || store.coverage.days_partial > 0) return 'partial'
  if (store.totals.orders_count === 0) return 'empty'
  return 'complete'
}

function countMetric(value: number | null, state: AnalyticsState, definition: string): AnalyticsMetric {
  return {
    value: value === null ? null : String(value),
    count: value,
    unit: 'count',
    state: value === null ? 'missing' : state,
    definition,
    numerator: null,
    denominator: null,
  }
}

function decimalMetric(value: string | null, state: AnalyticsState, definition: string): AnalyticsMetric {
  return {
    value,
    count: null,
    unit: 'decimal',
    state: value === null ? 'missing' : state,
    definition,
    numerator: null,
    denominator: null,
  }
}

function forbiddenMetric(definition: string): AnalyticsMetric {
  return {
    value: null,
    count: null,
    unit: 'decimal',
    state: 'forbidden',
    definition,
    numerator: null,
    denominator: null,
  }
}

function storeResult(store: KpiReaderStore): AnalyticsStoreResult {
  const state = scopedState(store)
  const totals = store.totals

  const metrics: Record<string, AnalyticsMetric> = {
    orders: countMetric(totals.orders_count, state, 'V5 : commandes sur la période métier (axe commande)'),
    delivered: countMetric(totals.delivered_count, state, 'V5 : commandes livrées (axe commande)'),
    returned: countMetric(totals.returned_count, state, 'V5 : retours (statuts canoniques)'),
    cancelled: countMetric(totals.cancelled_count, state, 'V5 : annulations (statuts canoniques)'),
    revenue: decimalMetric(toDecimalText(totals.revenue), state, 'V5 : CA réalisé (lignes des commandes livrées)'),
    revenueEstimated: decimalMetric(toDecimalText(totals.revenue_estimated), state, 'V5 : CA estimé, distinct du CA réalisé'),
    adSpend: decimalMetric(toDecimalText(totals.ad_spend_contract), state, 'V5 : publicité (couverture journalière + fallback)'),
  }

  const deliveryRate = percentOfCounts(totals.delivered_count, totals.orders_count)
  metrics.deliveryRate = {
    value: deliveryRate,
    count: null,
    unit: 'percent',
    state: deliveryRate === null ? 'missing' : state,
    definition: 'V5 : livrées / commandes — ce n’est pas un taux de confirmation',
    numerator: totals.delivered_count,
    denominator: totals.orders_count,
  }

  if (hasFinancialTotals(store)) {
    metrics.purchaseCost = decimalMetric(toDecimalText(store.totals.purchase_cost), state, 'V5 : coût d’achat des commandes livrées')
    metrics.deliveryCost = decimalMetric(toDecimalText(store.totals.delivery_fee_cost), state, 'V5 : coût de livraison (axe commande)')
    metrics.confirmationCost = decimalMetric(toDecimalText(store.totals.confirmation_cost), state, 'V5 : coût de confirmation')
    metrics.contributionMargin = decimalMetric(
      toDecimalText(store.totals.contribution_margin),
      state,
      'V5 : marge contributive — PAS le résultat opérationnel',
    )
  } else {
    for (const name of ['purchaseCost', 'deliveryCost', 'confirmationCost', 'contributionMargin']) {
      metrics[name] = forbiddenMetric('V5 : accès financier `full` requis')
    }
  }

  const coverage: AnalyticsCoverage = { ...store.coverage }

  return {
    storeId: store.store_id,
    currency: store.currency,
    timeZone: store.tz,
    access: store.access,
    definitionVersion: store.definition_version,
    coverage,
    revision: store.revision,
    lastRebuildAt: store.last_rebuild_at ?? null,
    state,
    metrics,
    days: store.points.map((point) => ({
      date: point.date,
      state: point.state === 'aggregate' || point.state === 'direct' ? 'complete' : 'partial',
      orders: Number.isSafeInteger(point.orders_count) ? point.orders_count : null,
      delivered: Number.isSafeInteger(point.delivered_count) ? point.delivered_count : null,
      revenue: toDecimalText(point.revenue),
      ads: toDecimalText(point.ads),
      partial: point.partial,
    })),
  }
}

function globalState(stores: AnalyticsStoreResult[]): AnalyticsState {
  if (stores.length === 0) return 'missing'
  if (stores.every((store) => store.state === 'forbidden')) return 'forbidden'
  if (stores.some((store) => store.state === 'missing')) return 'missing'
  if (stores.some((store) => store.state === 'partial')) return 'partial'
  if (stores.every((store) => store.state === 'empty')) return 'empty'
  return 'complete'
}


/**
 * Lecture KPI d'un périmètre et d'une période.
 *
 * Aucune exception de validation n'est transformée en chiffre : un payload
 * invalide produit `missing` avec la liste des anomalies.
 */
export async function readAssistantKpis(
  supabase: SupabaseClient,
  storeIds: string[],
  range: BusinessRange,
): Promise<AnalyticsReaderResult> {
  assertBusinessRange(range)
  const unique = Array.from(new Set(storeIds))
  if (unique.length !== storeIds.length || unique.length === 0 || unique.length > MAX_SCOPE_STORES) {
    return {
      contractVersion: ANALYTICS_CONTRACT_VERSION,
      state: 'missing',
      range,
      source: 'rpc_dashboard_kpi_reader_v2',
      generatedAt: null,
      stores: [],
      limits: ['Périmètre invalide : aucune lecture effectuée.'],
      issues: ['ANALYTICS_BAD_SCOPE'],
    }
  }

  try {
    const raw = await fetchDashboardKpiReader(supabase, {
      storeIds: unique,
      from: range.from,
      to: range.to,
      includeDirect: false,
      rpc: KPI_READER_RPC_V2,
    })

    const validation = validateKpiPayload(raw)
    if (!validation.ok) {
      return {
        contractVersion: ANALYTICS_CONTRACT_VERSION,
        state: 'missing',
        range,
        source: 'rpc_dashboard_kpi_reader_v2',
        generatedAt: null,
        stores: [],
        limits: ['Payload V5 invalide : aucune valeur publiée.'],
        issues: validation.issues,
      }
    }

    const payload = validation.payload
    const missingStores = unique.filter((id) => !payload.stores.some((store) => store.store_id === id))
    if (missingStores.length > 0) {
      return {
        contractVersion: ANALYTICS_CONTRACT_VERSION,
        state: 'missing',
        range,
        source: 'rpc_dashboard_kpi_reader_v2',
        generatedAt: payload.generated_at,
        stores: [],
        limits: ['Périmètre incomplet : le lecteur n’a pas retourné toutes les boutiques demandées.'],
        issues: [`ANALYTICS_INCOMPLETE_SCOPE:${missingStores.join(',')}`],
      }
    }

    const stores = payload.stores.map(storeResult)
    return {
      contractVersion: ANALYTICS_CONTRACT_VERSION,
      state: globalState(stores),
      range,
      source: 'rpc_dashboard_kpi_reader_v2',
      generatedAt: payload.generated_at,
      stores,
      limits: [
        'Montants non additionnés entre devises distinctes.',
        'Couverture absente ou sale : aucun scan direct de secours.',
        'Le résultat opérationnel (après dépenses) requiert une RPC financière dédiée.',
      ],
      issues: [],
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ANALYTICS_UNKNOWN'
    if (message.includes('KPI_NO_ACCESS') || message.includes('KPI_UNAUTHENTICATED')) {
      return {
        contractVersion: ANALYTICS_CONTRACT_VERSION,
        state: 'forbidden',
        range,
        source: 'rpc_dashboard_kpi_reader_v2',
        generatedAt: null,
        stores: [],
        limits: ['Accès refusé par le lecteur V5 : aucune donnée retournée.'],
        issues: [message],
      }
    }
    return {
      contractVersion: ANALYTICS_CONTRACT_VERSION,
      state: 'missing',
      range,
      source: 'rpc_dashboard_kpi_reader_v2',
      generatedAt: null,
      stores: [],
      limits: ['Lecture V5 indisponible : aucune valeur publiée.'],
      issues: [message],
    }
  }
}


/**
 * Session analytique : périmètre et période immuables, lecture V5 mémorisée.
 * Le consommateur peut injecter n'importe quel `AnalyticsKpiSource` pour
 * partager la même lecture entre plusieurs outils.
 */
export function createAssistantAnalyticsSession(
  supabase: SupabaseClient,
  storeIds: string[],
  range: BusinessRange,
): AssistantAnalyticsSession {
  assertBusinessRange(range)
  const frozenStores = Object.freeze([...storeIds])
  const frozenRange = Object.freeze({ ...range })
  let pending: Promise<AnalyticsReaderResult> | null = null

  return {
    supabase,
    storeIds: frozenStores,
    range: frozenRange,
    kpis: () => {
      if (!pending) pending = readAssistantKpis(supabase, [...frozenStores], frozenRange)
      return pending
    },
  }
}

function sumMetricText(result: AnalyticsReaderResult, name: string): string | null {
  if (result.stores.length === 0) return null
  const currencies = new Set(result.stores.map((store) => store.currency))
  if (currencies.size !== 1) return null

  const values: Array<string | null> = []
  for (const store of result.stores) {
    const metric = store.metrics[name]
    if (!metric || metric.state === 'forbidden' || metric.state === 'missing') return null
    values.push(metric.value)
  }
  return sumDecimals(values)
}



function fullyCovered(result: AnalyticsReaderResult): boolean {
  return result.stores.length > 0 && result.stores.every(
    (store) => store.coverage.days_aggregate + store.coverage.days_direct === store.coverage.days_total
      && store.coverage.days_dirty === 0
      && store.coverage.days_incompatible === 0,
  )
}

function definitionsOf(result: AnalyticsReaderResult): number[] {
  return Array.from(new Set(result.stores.map((store) => store.definitionVersion))).sort((a, b) => a - b)
}

function sameScopeAndCurrency(a: AnalyticsReaderResult, b: AnalyticsReaderResult): boolean {
  if (a.stores.length === 0 || a.stores.length !== b.stores.length) return false
  return a.stores.every((store, index) => {
    const other = b.stores[index]
    return Boolean(other) && other.storeId === store.storeId && other.currency === store.currency
  })
}

/**
 * Comparaison de deux périodes réelles pour le même périmètre.
 *
 * `baseline` est explicite : à défaut, la période précédente de même durée est
 * utilisée. Aucun écart n'est publié si les définitions, devises, couvertures
 * ou niveaux d'accès diffèrent.
 */
export async function compareAssistantPeriods(
  supabase: SupabaseClient,
  storeIds: string[],
  current: BusinessRange,
  baseline?: BusinessRange,
): Promise<PeriodComparison> {
  assertBusinessRange(current)
  const previousRange = baseline ? assertBusinessRange(baseline) : assertBusinessRange(previousBusinessRange(current))

  const [currentResult, baselineResult] = await Promise.all([
    readAssistantKpis(supabase, storeIds, current),
    readAssistantKpis(supabase, storeIds, previousRange),
  ])

  const notices: string[] = []
  const issues: string[] = []
  const deltas: MetricDelta[] = []

  const sameScope = sameScopeAndCurrency(currentResult, baselineResult)
  const sameDefinitions =
    JSON.stringify(definitionsOf(currentResult)) === JSON.stringify(definitionsOf(baselineResult))
  const covered = fullyCovered(currentResult) && fullyCovered(baselineResult)
  const accessible = currentResult.state !== 'forbidden' && baselineResult.state !== 'forbidden'
  const comparable = sameScope && sameDefinitions && covered && accessible

  if (!accessible) notices.push('Périodes non comparables : accès refusé sur au moins une période.')
  if (!sameScope) notices.push('Périodes non comparables : périmètre ou devise différents.')
  if (!sameDefinitions) notices.push('Périodes non comparables : versions de définition KPI différentes.')
  if (!covered) notices.push('Périodes non comparables : couverture incomplète ou journée sale.')

  for (const metric of COMPARABLE_METRICS) {
    const currentValue = sumMetricText(currentResult, metric)
    const baselineValue = sumMetricText(baselineResult, metric)

    if (!comparable) {
      deltas.push({
        metric,
        current: currentValue,
        baseline: baselineValue,
        delta: null,
        state: accessible ? 'partial' : 'forbidden',
        reason: accessible ? 'NOT_COMPARABLE' : 'FORBIDDEN',
      })
      continue
    }

    if (currentValue === null || baselineValue === null) {
      deltas.push({
        metric,
        current: currentValue,
        baseline: baselineValue,
        delta: null,
        state: 'missing',
        reason: 'METRIC_UNAVAILABLE',
      })
      continue
    }

    deltas.push({
      metric,
      current: currentValue,
      baseline: baselineValue,
      delta: subtractDecimals(currentValue, baselineValue),
      state: 'complete',
      reason: null,
    })
  }

  const state: AnalyticsState = !accessible
    ? 'forbidden'
    : deltas.every((delta) => delta.state === 'complete')
      ? 'complete'
      : deltas.every((delta) => delta.state === 'missing')
        ? 'missing'
        : 'partial'

  if (state !== 'complete') issues.push('COMPARISON_NOT_FULLY_COMPUTABLE')

  return {
    contractVersion: ANALYTICS_CONTRACT_VERSION,
    kind: 'periods',
    state,
    ranges: { current, baseline: previousRange },
    currency: (() => {
      const currencies = new Set(currentResult.stores.map((store) => store.currency))
      return currencies.size === 1 ? Array.from(currencies)[0] : null
    })(),
    definitions: { current: definitionsOf(currentResult), baseline: definitionsOf(baselineResult) },
    deltas,
    notices,
    issues,
  }
}


function storeEntry(store: AnalyticsStoreResult): StoreComparisonEntry {
  const metrics = {} as Record<ComparableMetric, string | null>
  for (const metric of COMPARABLE_METRICS) {
    const value = store.metrics[metric]
    metrics[metric] = value && value.state !== 'forbidden' && value.state !== 'missing' ? value.value : null
  }
  return {
    storeId: store.storeId,
    currency: store.currency,
    state: store.state,
    coverage: store.coverage,
    metrics,
  }
}

/**
 * Comparaison entre boutiques (jamais une comparaison de périodes).
 *
 * Aucun total inter-boutiques n'est produit : les écarts sont calculés deux à
 * deux, uniquement entre boutiques de même devise, complètes et de même
 * version de définition.
 */
export async function compareAssistantStores(
  supabase: SupabaseClient,
  storeIds: string[],
  range: BusinessRange,
): Promise<StoreComparison> {
  assertBusinessRange(range)
  const result = await readAssistantKpis(supabase, storeIds, range)

  const notices: string[] = []
  const issues: string[] = [...result.issues]
  const entries = result.stores.map(storeEntry)

  if (storeIds.length < 2) {
    notices.push('Comparaison entre boutiques impossible : au moins deux boutiques sont requises.')
  }

  const deltas: StoreComparison['deltas'] = []
  const comparableStores = result.stores.filter(
    (store) => store.state === 'complete' || store.state === 'empty',
  )

  for (let i = 0; i < comparableStores.length; i += 1) {
    for (let j = i + 1; j < comparableStores.length; j += 1) {
      const from = comparableStores[i]
      const to = comparableStores[j]
      const compatible = from.currency === to.currency && from.definitionVersion === to.definitionVersion

      for (const metric of COMPARABLE_METRICS) {
        if (!compatible) {
          deltas.push({ from: from.storeId, to: to.storeId, metric, delta: null, state: 'partial' })
          continue
        }
        const left = from.metrics[metric]?.value ?? null
        const right = to.metrics[metric]?.value ?? null
        deltas.push({
          from: from.storeId,
          to: to.storeId,
          metric,
          delta: left !== null && right !== null ? subtractDecimals(left, right) : null,
          state: left !== null && right !== null ? 'complete' : 'missing',
        })
      }
    }
  }

  if (entries.some((entry) => entry.state === 'partial' || entry.state === 'missing')) {
    notices.push('Au moins une boutique n’est pas complète : ses écarts ne sont pas calculés.')
  }
  const currencies = new Set(entries.map((entry) => entry.currency))
  if (currencies.size > 1) {
    notices.push('Devises multiples : aucun total inter-boutiques, seuls les écarts de même devise sont calculés.')
  }

  const state: AnalyticsState = result.state === 'forbidden'
    ? 'forbidden'
    : entries.length < 2
      ? 'unavailable'
      : entries.some((entry) => entry.state === 'partial')
        ? 'partial'
        : entries.some((entry) => entry.state === 'missing')
          ? 'missing'
          : 'complete'

  return {
    contractVersion: ANALYTICS_CONTRACT_VERSION,
    kind: 'stores',
    state,
    range,
    stores: entries,
    deltas,
    notices,
    issues,
  }
}



/**
 * Construit l'enveloppe KPI consommable : alias stables, états conservés,
 * détail par boutique. Aucun alias n'est rempli par défaut.
 */
export function buildKpiEnvelope(kpis: AnalyticsReaderResult): KpiEnvelope {
  const metrics: KpiEnvelope['metrics'] = {}
  for (const [alias, metricName] of Object.entries(KPI_METRIC_ALIASES) as Array<[KpiMetricAlias, string]>) {
    metrics[alias] = aggregateMetric(kpis, metricName)
  }

  const currencies = Array.from(new Set(kpis.stores.map((store) => store.currency)))
  const access: Record<string, 'full' | 'commercial'> = {}
  for (const store of kpis.stores) access[store.storeId] = store.access

  const limits = [...kpis.limits]
  if (currencies.length > 1) {
    limits.push('Devises multiples : les montants agrégés ne sont pas publiés.')
  }

  return {
    contractVersion: ANALYTICS_CONTRACT_VERSION,
    kind: 'kpis',
    state: kpis.state,
    range: kpis.range,
    timeZone: kpis.stores[0]?.timeZone ?? null,
    currency: currencies.length === 1 ? currencies[0] : null,
    definitionVersions: Array.from(new Set(kpis.stores.map((store) => store.definitionVersion))).sort((a, b) => a - b),
    access,
    coverage: kpis.stores.map((store) => ({ storeId: store.storeId, state: store.state, coverage: store.coverage })),
    metrics,
    stores: kpis.stores,
    limits,
    issues: kpis.issues,
  }
}
