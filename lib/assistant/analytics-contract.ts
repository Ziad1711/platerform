/**
 * Contrat analytique versionné du chatbot Jisra.
 *
 * Source unique des types et des états. Aucune couche consommatrice ne doit
 * interpréter un champ absent comme un zéro : chaque valeur porte son état.
 *
 * Version : voir `ANALYTICS_CONTRACT_VERSION`. Toute rupture de forme ou de
 * sémantique doit incrémenter cette version et être signalée au consommateur.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BusinessRange } from '@/lib/dashboard/business-time'
import { compareDecimals, percentOfCounts, sumDecimals } from '@/lib/assistant/analytics-decimal'

export { toDecimalText } from '@/lib/assistant/analytics-decimal'
export { rangeInstants as instants } from '@/lib/assistant/analytics-range'

/** Version du contrat consommateur (types, états, sémantique des comparaisons). */
export const ANALYTICS_CONTRACT_VERSION = 2

/**
 * États explicites :
 * - `complete`     : donnée complète pour la définition annoncée ;
 * - `empty`        : période lue avec succès, population réellement vide (zéro réel) ;
 * - `partial`      : donnée incomplète (couverture, troncature, contrôle V5) ;
 * - `missing`      : donnée absente ou illisible ; aucune valeur publiée ;
 * - `forbidden`    : accès refusé par le périmètre ;
 * - `unavailable`  : agrégat non disponible (aucune source autorisée).
 */
export type AnalyticsState = 'complete' | 'empty' | 'partial' | 'missing' | 'forbidden' | 'unavailable'

export type AnalyticsMetricUnit = 'count' | 'decimal' | 'percent'

export interface AnalyticsMetric {
  /** Valeur exacte en texte (jamais d'exposant) ; `null` si non publiée. */
  value: string | null
  /** Compteur validé, uniquement pour `unit === 'count'`. */
  count: number | null
  unit: AnalyticsMetricUnit
  state: AnalyticsState
  definition: string
  numerator: number | null
  denominator: number | null
  limit?: string
}

export interface AnalyticsDayPoint {
  date: string
  state: AnalyticsState
  orders: number | null
  delivered: number | null
  revenue: string | null
  ads: string | null
  partial: boolean
}

export interface AnalyticsCoverage {
  days_total: number
  days_aggregate: number
  days_direct: number
  days_dirty: number
  days_missing: number
  days_incompatible: number
  days_partial: number
}

export interface AnalyticsStoreResult {
  storeId: string
  currency: string
  timeZone: string
  access: 'full' | 'commercial'
  definitionVersion: number
  coverage: AnalyticsCoverage
  revision: string
  lastRebuildAt: string | null
  state: AnalyticsState
  metrics: Record<string, AnalyticsMetric>
  days: AnalyticsDayPoint[]
}

export interface AnalyticsReaderResult {
  contractVersion: number
  state: AnalyticsState
  range: BusinessRange
  source: 'rpc_dashboard_kpi_reader_v2'
  generatedAt: string | null
  stores: AnalyticsStoreResult[]
  limits: string[]
  /** Anomalies de lecture ou de validation, jamais masquées. */
  issues: string[]
}

/** Alias consommateur → métrique V5 (contrat stable pour l'orchestrateur). */
export const KPI_METRIC_ALIASES = {
  totalOrders: 'orders',
  deliveredOrders: 'delivered',
  returnedOrders: 'returned',
  cancelledOrders: 'cancelled',
  revenue: 'revenue',
  revenueEstimated: 'revenueEstimated',
  adSpend: 'adSpend',
  deliveryRate: 'deliveryRate',
  purchaseCost: 'purchaseCost',
  deliveryCost: 'deliveryCost',
  confirmationCost: 'confirmationCost',
  contributionMargin: 'contributionMargin',
} as const

export type KpiMetricAlias = keyof typeof KPI_METRIC_ALIASES

/**
 * Enveloppe KPI destinée au consommateur : valeurs aplaties mais **jamais**
 * dénuées d'état. Un alias absent vaut `null`, pas `0`.
 */
export interface KpiEnvelope {
  contractVersion: number
  kind: 'kpis'
  state: AnalyticsState
  range: BusinessRange
  timeZone: string | null
  currency: string | null
  definitionVersions: number[]
  access: Record<string, 'full' | 'commercial'>
  coverage: Array<{ storeId: string; state: AnalyticsState; coverage: AnalyticsCoverage }>
  metrics: Partial<Record<KpiMetricAlias, AnalyticsMetric | null>>
  /** Détail par boutique : aucune somme inter-devises implicite. */
  stores: AnalyticsStoreResult[]
  limits: string[]
  issues: string[]
}

export interface ConsistencyCheck {
  metric: string
  v5: string | null
  section: string | null
  /** `null` = non comparable (valeur absente d'un côté). */
  match: boolean | null
  reason?: string
}

export interface SectionMeta {
  contractVersion: number
  section: string
  state: AnalyticsState
  source: string
  range: BusinessRange
  timeZone: string
  currencies: string[]
  access: Record<string, 'full' | 'commercial'>
  notices: string[]
  limits: string[]
  consistency: ConsistencyCheck[]
  issues: string[]
}

export interface SectionResult<Row> {
  meta: SectionMeta
  rows: Row[]
  totals: Record<string, string | number | null>
}

export interface SectionRequest {
  supabase: SupabaseClient
  /** Lecture V5 déjà effectuée pour la même période et le même périmètre. */
  kpis: AnalyticsReaderResult
}

/** Source KPI injectable : permet de partager une lecture entre plusieurs outils. */
export interface AnalyticsKpiSource {
  kpis: () => Promise<AnalyticsReaderResult>
}

/** Session analytique immuable : périmètre, période et lecture V5 mémorisée. */
export interface AssistantAnalyticsSession extends AnalyticsKpiSource {
  supabase: SupabaseClient
  storeIds: readonly string[]
  range: BusinessRange
}

/** Métriques comparables entre deux périodes (montants exacts). */
export const COMPARABLE_METRICS = ['orders', 'delivered', 'revenue', 'adSpend', 'contributionMargin'] as const

export type ComparableMetric = (typeof COMPARABLE_METRICS)[number]

export interface MetricDelta {
  metric: ComparableMetric
  current: string | null
  baseline: string | null
  /** Différence exacte `current - baseline`, `null` si non comparable. */
  delta: string | null
  state: AnalyticsState
  reason: string | null
}

export interface ComparisonFreshness {
  /** Instant de lecture du payload (observabilité, pas fraîcheur métier). */
  readAt: string | null
  /** Ancienne clé conservée pour compatibilité ; équivaut à `readAt`. */
  generatedAt: string | null
  oldestRebuildAt: string | null
  /** Âge de l'agrégat le plus ancien, en heures (null si non daté). */
  ageHours: number | null
  stale: boolean
}

export interface PeriodComparison {
  contractVersion: number
  kind: 'periods'
  state: AnalyticsState
  ranges: { current: BusinessRange; baseline: BusinessRange }
  currency: string | null
  definitions: { current: number[]; baseline: number[] }
  deltas: MetricDelta[]
  freshness?: ComparisonFreshness
  notices: string[]
  issues: string[]
}

export interface StoreComparisonEntry {
  storeId: string
  currency: string
  state: AnalyticsState
  coverage: AnalyticsCoverage
  metrics: Record<ComparableMetric, string | null>
}

export interface StoreComparison {
  contractVersion: number
  kind: 'stores'
  state: AnalyticsState
  range: BusinessRange
  stores: StoreComparisonEntry[]
  /** Écarts calculés uniquement entre boutiques compatibles (même devise). */
  deltas: Array<{ from: string; to: string; metric: ComparableMetric; delta: string | null; state: AnalyticsState }>
  notices: string[]
  issues: string[]
}

/** Entier strictement validé : jamais `4.5`, `NaN`, `"12abc"` ou hors plage sûre. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null
  if (typeof value === 'bigint') {
    const asNumber = Number(value)
    return Number.isSafeInteger(asNumber) ? asNumber : null
  }
  if (typeof value === 'string' && /^[+-]?\d+$/.test(value.trim())) {
    const asNumber = Number(value.trim())
    return Number.isSafeInteger(asNumber) ? asNumber : null
  }
  return null
}

/** Métrique non publiée : aucune valeur, état explicite. */
export function metricUnavailable(state: AnalyticsState, definition: string, limit?: string): AnalyticsMetric {
  return {
    value: null,
    count: null,
    unit: 'decimal',
    state,
    definition,
    numerator: null,
    denominator: null,
    ...(limit ? { limit } : {}),
  }
}


export function baseMeta(
  section: string,
  source: string,
  kpis: AnalyticsReaderResult,
  state: AnalyticsState,
): SectionMeta {
  const access: Record<string, 'full' | 'commercial'> = {}
  for (const store of kpis.stores) access[store.storeId] = store.access
  return {
    contractVersion: ANALYTICS_CONTRACT_VERSION,
    section,
    state,
    source,
    range: kpis.range,
    timeZone: kpis.stores[0]?.timeZone ?? 'Africa/Casablanca',
    currencies: Array.from(new Set(kpis.stores.map((store) => store.currency))),
    access,
    notices: [],
    limits: [],
    consistency: [],
    issues: [],
  }
}

export function unavailable<Row>(
  section: string,
  source: string,
  kpis: AnalyticsReaderResult,
  reason: string,
): SectionResult<Row> {
  const meta = baseMeta(section, source, kpis, 'unavailable')
  meta.notices.push(reason)
  return { meta, rows: [], totals: {} }
}

export function forbidden<Row>(section: string, source: string, kpis: AnalyticsReaderResult): SectionResult<Row> {
  const meta = baseMeta(section, source, kpis, 'forbidden')
  meta.notices.push('Accès refusé par le lecteur KPI V5 : aucune donnée détaillée n’est retournée.')
  return { meta, rows: [], totals: {} }
}

/** Réponse RPC invalide : aucune valeur publiée, l'anomalie est conservée. */
export function invalidPayload<Row>(
  section: string,
  source: string,
  kpis: AnalyticsReaderResult,
  issues: string[],
): SectionResult<Row> {
  const meta = baseMeta(section, source, kpis, 'missing')
  meta.issues.push(...issues)
  meta.notices.push('Réponse RPC invalide : aucune valeur n’est publiée.')
  return { meta, rows: [], totals: {} }
}

export function authorizedStoreIds(kpis: AnalyticsReaderResult): string[] {
  return kpis.stores.map((store) => store.storeId)
}

export function allStoresFull(kpis: AnalyticsReaderResult): boolean {
  return kpis.stores.length > 0 && kpis.stores.every((store) => store.access === 'full')
}

export function singleCurrency(kpis: AnalyticsReaderResult): string | null {
  const currencies = Array.from(new Set(kpis.stores.map((store) => store.currency)))
  return currencies.length === 1 ? currencies[0] : null
}

/** Valeur agrégée d'une métrique, ou `null` si non publiée. */
export function v5Value(kpis: AnalyticsReaderResult, name: string): string | null {
  const metric = aggregateMetric(kpis, name)
  return metric && metric.state !== 'forbidden' && metric.state !== 'missing' ? metric.value : null
}

/**
 * Contrôle de cohérence entre une section et le V5.
 * `match: null` signifie « non comparable » (jamais un faux PASS).
 */
export function check(metric: string, v5: string | null, section: string | null): ConsistencyCheck {
  if (v5 === null || section === null) {
    return { metric, v5, section, match: null, reason: 'NOT_COMPARABLE' }
  }
  const comparison = compareDecimals(v5, section)
  if (comparison === null) return { metric, v5, section, match: null, reason: 'UNPARSABLE' }
  return { metric, v5, section, match: comparison === 0 }
}

/**
 * Applique les contrôles : un écart réel dégrade l'état (`partial`) et une
 * valeur non comparable ne dégrade pas l'état, elle est signalée à part.
 */
export function applyConsistency(meta: SectionMeta, checks: ConsistencyCheck[]): void {
  meta.consistency = checks
  const mismatch = checks.filter((item) => item.match === false)
  const incomparable = checks.filter((item) => item.match === null)

  if (mismatch.length > 0) {
    if (meta.state === 'complete' || meta.state === 'empty') meta.state = 'partial'
    meta.notices.push(
      `Écart avec le lecteur KPI V5 sur : ${mismatch.map((item) => item.metric).join(', ')}.`,
    )
  }
  if (incomparable.length > 0) {
    meta.notices.push(
      `Contrôle V5 non comparable sur : ${incomparable.map((item) => item.metric).join(', ')}.`,
    )
  }
}


/**
 * Agrège une métrique sur le périmètre : compteurs sommés, montants additionnés
 * en décimal exact, et `null` dès qu'une boutique ne publie pas la valeur.
 */
export function aggregateMetric(kpis: AnalyticsReaderResult, name: string): AnalyticsMetric | null {
  const metrics = kpis.stores
    .map((store) => store.metrics[name])
    .filter((item): item is AnalyticsMetric => Boolean(item))
  if (metrics.length !== kpis.stores.length || metrics.length === 0) return null

  const states = metrics.map((item) => item.state)
  const state: AnalyticsState = states.every((item) => item === 'forbidden')
    ? 'forbidden'
    : states.some((item) => item === 'forbidden' || item === 'missing')
      ? 'missing'
      : states.every((item) => item === 'empty')
        ? 'empty'
        : states.some((item) => item === 'partial')
          ? 'partial'
          : 'complete'

  const first = metrics[0]

  if (first.unit === 'count') {
    const counts = metrics.map((item) => item.count)
    const count = counts.every((item): item is number => item !== null)
      ? counts.reduce((sum, item) => sum + item, 0)
      : null
    return {
      value: count === null ? null : String(count),
      count,
      unit: 'count',
      state: count === null ? 'missing' : state,
      definition: first.definition,
      numerator: null,
      denominator: null,
    }
  }

  // Un pourcentage ne s'additionne jamais : il se recalcule sur les numérateurs
  // et dénominateurs agrégés.
  if (first.unit === 'percent') {
    const numerators = metrics.map((item) => item.numerator)
    const denominators = metrics.map((item) => item.denominator)
    const numerator = numerators.every((item): item is number => item !== null)
      ? numerators.reduce((sum, item) => sum + item, 0)
      : null
    const denominator = denominators.every((item): item is number => item !== null)
      ? denominators.reduce((sum, item) => sum + item, 0)
      : null
    const value = percentOfCounts(numerator, denominator)
    return {
      value,
      count: null,
      unit: 'percent',
      state: value === null ? 'missing' : state,
      definition: first.definition,
      numerator,
      denominator,
    }
  }

  // Montants : jamais de conversion flottante, jamais de somme inter-devises.
  if (!singleCurrency(kpis)) {
    return metricUnavailable('missing', `${first.definition} (devises multiples : aucune somme)`)
  }

  const summed = sumDecimals(metrics.map((item) => item.value))
  return {
    value: summed,
    count: null,
    unit: first.unit,
    state: summed === null ? 'missing' : state,
    definition: first.definition,
    numerator: null,
    denominator: null,
  }
}
