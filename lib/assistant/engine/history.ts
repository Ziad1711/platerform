/**
 * Qualification de l'absence de données.
 *
 * Distinction indispensable : « aucune commande sur la période » n'est pas
 * « le lecteur n'a pas de couverture » et encore moins « la base est
 * injoignable ». Confondre ces cas produisait des refus complets alors que des
 * chiffres fiables étaient disponibles.
 *
 * Chaque fenêtre reçoit une qualification unique, et la restitution en déduit
 * une phrase localisée — jamais un code technique.
 */
import type {
  AnalyticsCoverage,
  AnalyticsReaderResult,
  KpiMetricAlias,
} from '@/lib/assistant/analytics-contract'
import { KPI_METRIC_ALIASES } from '@/lib/assistant/analytics-contract'
import type { WindowReading } from '@/lib/assistant/engine/executor'
import { isHistoryDirectFallbackEnabled } from '@/lib/assistant/engine/policy'
import { periodDays } from '@/lib/assistant/semantic/periods'

export type DataAbsenceKind =
  /** Données présentes et exploitables. */
  | 'known'
  /** Période lue avec succès, population réellement vide : un zéro est vrai. */
  | 'genuinely_empty'
  /** Le lecteur n'a aucune couverture agrégée pour cette fenêtre. */
  | 'no_coverage'
  /** Couverture partielle : valeurs publiables avec réserve. */
  | 'coverage_partial'
  /** Échec technique du lecteur : l'absence n'est pas prouvée. */
  | 'source_unavailable'
  /** Période refusée (bornes invalides ou trop larges). */
  | 'range_rejected'
  /** Accès refusé par le périmètre. */
  | 'access_denied'
  /** Budget d'exécution dépassé : analyse volontairement bornée. */
  | 'budget_exceeded'
  | 'unknown'

export interface WindowAssessment {
  windowId: string
  kind: DataAbsenceKind
  /** Au moins une métrique publie une valeur. */
  hasValues: boolean
  publishedMetrics: KpiMetricAlias[]
  coverage: AnalyticsCoverage | null
  /** La qualification autorise une comparaison chiffrée. */
  comparable: boolean
}

function publishedMetrics(kpis: AnalyticsReaderResult): KpiMetricAlias[] {
  const published: KpiMetricAlias[] = []
  for (const store of kpis.stores) {
    for (const [alias, metricName] of Object.entries(KPI_METRIC_ALIASES) as Array<
      [KpiMetricAlias, string]
    >) {
      const metric = store.metrics[metricName]
      if (!metric || metric.value === null) continue
      if (metric.state === 'missing' || metric.state === 'forbidden' || metric.state === 'unavailable') {
        continue
      }
      if (!published.includes(alias)) published.push(alias)
    }
  }
  return published
}

function aggregateCoverage(kpis: AnalyticsReaderResult): AnalyticsCoverage | null {
  if (kpis.stores.length === 0) return null
  return kpis.stores.reduce<AnalyticsCoverage>(
    (total, store) => ({
      days_total: total.days_total + store.coverage.days_total,
      days_aggregate: total.days_aggregate + store.coverage.days_aggregate,
      days_direct: total.days_direct + store.coverage.days_direct,
      days_dirty: total.days_dirty + store.coverage.days_dirty,
      days_missing: total.days_missing + store.coverage.days_missing,
      days_incompatible: total.days_incompatible + store.coverage.days_incompatible,
      days_partial: total.days_partial + store.coverage.days_partial,
    }),
    {
      days_total: 0, days_aggregate: 0, days_direct: 0,
      days_dirty: 0, days_missing: 0, days_incompatible: 0, days_partial: 0,
    },
  )
}

/**
 * Cause technique derrière un état `missing`.
 *
 * Le lecteur V5 ne lève pas : il renvoie `missing` en conservant le code dans
 * `issues`. Sans cette lecture, un timeout PostgreSQL était présenté comme une
 * simple absence d'agrégat — l'utilisateur pouvait lire « aucune donnée » alors
 * que la source était injoignable.
 */
export function classifyReaderIssues(issues: readonly string[]): DataAbsenceKind | null {
  const codes = issues.map((issue) => String(issue ?? '').toUpperCase())
  if (codes.some((code) => code.includes('NO_ACCESS') || code.includes('FORBIDDEN') || code.includes('UNAUTHENTICATED'))) {
    return 'access_denied'
  }
  if (codes.some((code) => code.includes('BAD_RANGE') || code.includes('RANGE_TOO_LARGE'))) {
    return 'range_rejected'
  }
  if (codes.some((code) => code.includes('TIMEOUT') || code.includes('READER_FAILED') || code.includes('UNAVAILABLE'))) {
    return 'source_unavailable'
  }
  return null
}

/** Couverture réellement complète : aucune journée manquante, partielle ou sale. */
function fullyCoveredCoverage(coverage: AnalyticsCoverage | null): boolean {
  if (!coverage) return false
  return coverage.days_total > 0 &&
    coverage.days_missing === 0 &&
    coverage.days_partial === 0 &&
    coverage.days_dirty === 0 &&
    coverage.days_incompatible === 0
}

export function assessWindow(
  reading: WindowReading | undefined,
  options?: { budgetExceeded?: boolean },
): WindowAssessment {
  const empty: WindowAssessment = {
    windowId: reading?.windowId ?? '',
    kind: 'unknown',
    hasValues: false,
    publishedMetrics: [],
    coverage: null,
    comparable: false,
  }

  if (!reading) {
    return { ...empty, kind: options?.budgetExceeded ? 'budget_exceeded' : 'unknown' }
  }
  if (reading.failure === 'isolation_failure') return { ...empty, kind: 'access_denied' }
  if (reading.failure === 'range_rejected') return { ...empty, kind: 'range_rejected' }
  if (reading.failure) return { ...empty, kind: 'source_unavailable' }
  if (!reading.kpis) return { ...empty, kind: 'source_unavailable' }

  const kpis = reading.kpis
  const coverage = aggregateCoverage(kpis)
  const metrics = publishedMetrics(kpis)
  const hasValues = metrics.length > 0

  if (kpis.state === 'forbidden') {
    return { ...empty, kind: 'access_denied', coverage }
  }

  // Une cause technique prime sur toute lecture d'absence : elle est prouvée.
  const technical = classifyReaderIssues(kpis.issues)
  if (technical && !hasValues) {
    return { ...empty, kind: technical, coverage }
  }

  if (kpis.state === 'missing') {
    return { ...empty, kind: 'no_coverage', coverage }
  }

  // Population vide : prouvée seulement par un état `empty` du lecteur accompagné
  // d'au moins une boutique lue, ou par une couverture complète. Une réponse sans
  // aucune boutique ne prouve rien (périmètre perdu ou payload incomplet).
  const populationEmpty = kpis.stores.length > 0 &&
    kpis.stores.every((store) => (store.metrics.orders?.count ?? 0) === 0)
  if (kpis.state === 'empty' && kpis.stores.length > 0 && (fullyCoveredCoverage(coverage) || coverage !== null)) {
    return {
      windowId: reading.windowId,
      kind: 'genuinely_empty',
      hasValues: false,
      publishedMetrics: metrics,
      coverage,
      comparable: true,
    }
  }
  if (populationEmpty && fullyCoveredCoverage(coverage)) {
    return {
      windowId: reading.windowId,
      kind: 'genuinely_empty',
      hasValues: false,
      publishedMetrics: metrics,
      coverage,
      comparable: true,
    }
  }
  if (kpis.state === 'partial' || (populationEmpty && !fullyCoveredCoverage(coverage))) {
    return {
      windowId: reading.windowId,
      kind: 'coverage_partial',
      hasValues,
      publishedMetrics: metrics,
      coverage,
      comparable: hasValues,
    }
  }
  return {
    windowId: reading.windowId,
    kind: 'known',
    hasValues,
    publishedMetrics: metrics,
    coverage,
    comparable: true,
  }
}

/* -------------------------------------------------------------------------- */
/* Stratégie historique                                                       */
/* -------------------------------------------------------------------------- */

/** Fenêtre maximale d'un repli direct, si celui-ci est autorisé. */
export const HISTORY_DIRECT_MAX_DAYS = 62

export interface HistoryStrategyDecision {
  /** Une seconde lecture directe est-elle tentée pour cette fenêtre ? */
  attemptDirect: boolean
  /** Raison interne, jamais publiée telle quelle. */
  reason: 'flag_disabled' | 'values_published' | 'window_too_large' | 'not_needed' | 'attempt'
}

/**
 * Décide d'un repli direct **borné** pour une fenêtre sans couverture.
 *
 * Le repli reste désactivé par défaut : son coût PostgreSQL n'a pas été
 * démontré borné. La fonction existe pour que l'activation soit une décision
 * explicite, mesurable et réversible — jamais un `includeDirect: true` caché.
 */
export function decideHistoryStrategy(input: {
  assessment: WindowAssessment
  range: { from: string; to: string }
  env?: Record<string, string | undefined>
}): HistoryStrategyDecision {
  if (input.assessment.kind !== 'no_coverage') {
    return { attemptDirect: false, reason: 'not_needed' }
  }
  if (!isHistoryDirectFallbackEnabled(input.env ?? process.env)) {
    return { attemptDirect: false, reason: 'flag_disabled' }
  }
  const days = periodDays({
    id: input.assessment.windowId,
    months: [],
    range: input.range,
    granularity: 'month',
    year: null,
    aggregated: false,
  })
  if (days <= 0 || days > HISTORY_DIRECT_MAX_DAYS) {
    return { attemptDirect: false, reason: 'window_too_large' }
  }
  return { attemptDirect: true, reason: 'attempt' }
}

/** Clé de message localisée associée à une qualification d'absence. */
export function absenceMessageKey(kind: DataAbsenceKind): string {
  switch (kind) {
    case 'genuinely_empty': return 'absence.empty'
    case 'no_coverage': return 'absence.no_coverage'
    case 'coverage_partial': return 'absence.partial'
    case 'source_unavailable': return 'absence.unavailable'
    case 'range_rejected': return 'absence.range'
    case 'access_denied': return 'absence.access'
    case 'budget_exceeded': return 'absence.budget'
    case 'known': return 'absence.none'
    default: return 'absence.unknown'
  }
}
