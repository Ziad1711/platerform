/**
 * Comparabilité **par métrique**.
 *
 * L'ancien moteur exigeait une signature de couverture identique pour toute la
 * comparaison, y compris le nombre de jours. Deux mois de 30 et 31 jours étaient
 * donc déclarés « non comparables » alors que leurs totaux étaient parfaitement
 * lisibles.
 *
 * Le moteur actuel décide métrique par métrique, publie les totaux côte à côte
 * même lorsque la durée diffère, et signale la réserve au lieu de refuser.
 *
 * Aucune valeur n'est inventée : une métrique absente reste absente.
 */
import type { AnalyticsMetric, AnalyticsState, KpiMetricAlias } from '@/lib/assistant/analytics-contract'
import { METRIC_CATALOG, isMetricAllowed, type MetricAccess } from '@/lib/assistant/semantic/catalog'
import { subtractDecimalText, compareDecimalText } from '@/lib/assistant/semantic/decimal'

export type ComparabilityDecision =
  /** Écart calculable et interprétable sans réserve. */
  | 'comparable'
  /** Écart calculable, avec une réserve explicite (couverture, durée). */
  | 'comparable_with_reserve'
  /** Valeurs affichables côte à côte, écart non calculé. */
  | 'side_by_side_only'
  /** Aucune valeur exploitable d'un côté au moins. */
  | 'not_computable'
  /** Accès refusé : ni valeur, ni écart. */
  | 'forbidden'

/** Clés de réserve localisées : jamais de code interne dans la réponse. */
export type ComparabilityReasonKey =
  | 'reason.coverage_partial'
  | 'reason.duration_differs'
  | 'reason.definition_differs'
  | 'reason.metric_missing'
  | 'reason.access_denied'
  | 'reason.stale'

export interface PeriodSideInput {
  metrics: Partial<Record<KpiMetricAlias, AnalyticsMetric | null>>
  state: AnalyticsState
  days: number
  definitionVersion: number | null
}

export interface MetricComparability {
  metric: KpiMetricAlias
  decision: ComparabilityDecision
  reasons: ComparabilityReasonKey[]
  daysCurrent: number
  daysBaseline: number
  /** La durée diffère : les totaux restent lisibles, l'interprétation est bornée. */
  durationDiffers: boolean
  /** Un indicateur normalisé par jour doit accompagner le total. */
  needsDurationNormalization: boolean
}

/** Une métrique publiée sans valeur ne peut jamais produire d'écart. */
function hasValue(metric: AnalyticsMetric | null | undefined): boolean {
  return Boolean(metric) && metric!.value !== null && metric!.state !== 'missing' &&
    metric!.state !== 'forbidden' && metric!.state !== 'unavailable'
}

function isForbidden(metric: AnalyticsMetric | null | undefined): boolean {
  return Boolean(metric) && metric!.state === 'forbidden'
}

export function decideMetricComparability(input: {
  metric: KpiMetricAlias
  current: PeriodSideInput
  baseline: PeriodSideInput
  access: MetricAccess
  stale?: boolean
}): MetricComparability {
  const { metric, current, baseline, access } = input
  const definition = METRIC_CATALOG[metric]
  const daysCurrent = current.days
  const daysBaseline = baseline.days
  const durationDiffers = daysCurrent > 0 && daysBaseline > 0 && daysCurrent !== daysBaseline

  const base: Omit<MetricComparability, 'decision' | 'reasons'> = {
    metric,
    daysCurrent,
    daysBaseline,
    durationDiffers,
    needsDurationNormalization: durationDiffers && definition.durationSensitivity === 'total',
  }

  if (!isMetricAllowed(metric, access) ||
      isForbidden(current.metrics[metric]) || isForbidden(baseline.metrics[metric])) {
    return { ...base, decision: 'forbidden', reasons: ['reason.access_denied'] }
  }

  const currentValue = current.metrics[metric]
  const baselineValue = baseline.metrics[metric]

  if (!hasValue(currentValue) && !hasValue(baselineValue)) {
    return { ...base, decision: 'not_computable', reasons: ['reason.metric_missing'] }
  }

  if (!hasValue(currentValue) || !hasValue(baselineValue)) {
    return { ...base, decision: 'side_by_side_only', reasons: ['reason.metric_missing'] }
  }

  const reasons: ComparabilityReasonKey[] = []

  if (current.definitionVersion !== null && baseline.definitionVersion !== null &&
      current.definitionVersion !== baseline.definitionVersion) {
    reasons.push('reason.definition_differs')
    return { ...base, decision: 'side_by_side_only', reasons }
  }

  if (input.stale) reasons.push('reason.stale')

  const partial = currentValue!.state === 'partial' || baselineValue!.state === 'partial' ||
    current.state === 'partial' || baseline.state === 'partial'
  if (partial) reasons.push('reason.coverage_partial')

  // Une différence de durée n'interdit plus la comparaison : elle la nuance.
  if (durationDiffers) reasons.push('reason.duration_differs')

  const decision: ComparabilityDecision = reasons.length === 0 ? 'comparable' : 'comparable_with_reserve'
  return { ...base, decision, reasons }
}

export interface MetricDeltaResult {
  metric: KpiMetricAlias
  current: string | null
  baseline: string | null
  delta: string | null
  direction: 'up' | 'down' | 'flat' | null
  comparability: MetricComparability
}

/** L'écart n'est calculé que lorsque la décision l'autorise. */
export function computeMetricDelta(input: {
  metric: KpiMetricAlias
  current: PeriodSideInput
  baseline: PeriodSideInput
  access: MetricAccess
  stale?: boolean
}): MetricDeltaResult {
  const comparability = decideMetricComparability(input)
  const currentMetric = input.current.metrics[input.metric]
  const baselineMetric = input.baseline.metrics[input.metric]
  const currentValue = hasValue(currentMetric) ? currentMetric!.value : null
  const baselineValue = hasValue(baselineMetric) ? baselineMetric!.value : null

  const computable =
    comparability.decision === 'comparable' || comparability.decision === 'comparable_with_reserve'
  const delta =
    computable && currentValue !== null && baselineValue !== null
      ? subtractDecimalText(currentValue, baselineValue)
      : null
  const ordering = delta === null ? null : compareDecimalText(delta, '0')

  return {
    metric: input.metric,
    current: currentValue,
    baseline: baselineValue,
    delta,
    direction: ordering === null ? null : ordering > 0 ? 'up' : ordering < 0 ? 'down' : 'flat',
    comparability,
  }
}

/** Décide la comparabilité de plusieurs métriques en une passe. */
export function decideComparability(input: {
  metrics: readonly KpiMetricAlias[]
  current: PeriodSideInput
  baseline: PeriodSideInput
  access: MetricAccess
  stale?: boolean
}): MetricDeltaResult[] {
  return input.metrics.map((metric) =>
    computeMetricDelta({
      metric,
      current: input.current,
      baseline: input.baseline,
      access: input.access,
      stale: input.stale,
    }),
  )
}

/** Résumé exploitable par la présentation, sans code interne. */
export interface ComparabilityCounts {
  comparable: number
  withReserve: number
  sideBySide: number
  notComputable: number
  forbidden: number
}

export function comparabilitySummary(results: readonly MetricDeltaResult[]): ComparabilityCounts {
  const counts: ComparabilityCounts = {
    comparable: 0, withReserve: 0, sideBySide: 0, notComputable: 0, forbidden: 0,
  }
  for (const result of results) {
    switch (result.comparability.decision) {
      case 'comparable':
        counts.comparable += 1
        break
      case 'comparable_with_reserve':
        counts.withReserve += 1
        break
      case 'side_by_side_only':
        counts.sideBySide += 1
        break
      case 'not_computable':
        counts.notComputable += 1
        break
      case 'forbidden':
        counts.forbidden += 1
        break
    }
  }
  return counts
}

/** Vrai si au moins une métrique publie un écart interprétable. */
export function hasUsableComparison(results: readonly MetricDeltaResult[]): boolean {
  return results.some((result) => result.delta !== null)
}
