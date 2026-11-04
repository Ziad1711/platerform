/**
 * Catalogue sémantique des métriques de l'assistant.
 *
 * Ce catalogue est la seule source autorisant une métrique à être lue,
 * agrégée ou comparée. Il remplace les listes dispersées : un indicateur non
 * déclaré ici ne peut pas être demandé au moteur, ni par l'utilisateur, ni par
 * une proposition du modèle.
 *
 * Aucune définition n'est dupliquée depuis SQL : `analytics-contract` reste la
 * référence des formules V5, ce catalogue décrit les règles d'usage.
 */
import type { KpiMetricAlias } from '@/lib/assistant/analytics-contract'

export type MetricAccess = 'commercial' | 'full'
export type MetricUnit = 'count' | 'decimal' | 'percent'
/** Axe temporel : ce que la date mesure réellement. */
export type TimeAxis = 'order' | 'delivery' | 'cash'
/** Sensibilité à la durée de la fenêtre observée. */
export type DurationSensitivity = 'rate' | 'total'

export interface MetricDefinition {
  id: KpiMetricAlias
  unit: MetricUnit
  /** Niveau d'accès minimal pour publier la valeur. */
  access: MetricAccess
  axis: TimeAxis
  /**
   * `total` : la valeur dépend mécaniquement de la durée (un mois de 31 jours
   * ne se compare pas directement à 30 jours). `rate` : déjà normalisée.
   */
  durationSensitivity: DurationSensitivity
  /** Une cohorte récente n'est pas un résultat définitif (livraisons en cours). */
  cohortSensitive: boolean
  /** Métrique financière : jamais publiée hors accès `full`. */
  financial: boolean
}

export const METRIC_CATALOG: Record<KpiMetricAlias, MetricDefinition> = {
  totalOrders: {
    id: 'totalOrders', unit: 'count', access: 'commercial', axis: 'order',
    durationSensitivity: 'total', cohortSensitive: true, financial: false,
  },
  deliveredOrders: {
    id: 'deliveredOrders', unit: 'count', access: 'commercial', axis: 'order',
    durationSensitivity: 'total', cohortSensitive: true, financial: false,
  },
  returnedOrders: {
    id: 'returnedOrders', unit: 'count', access: 'commercial', axis: 'order',
    durationSensitivity: 'total', cohortSensitive: true, financial: false,
  },
  cancelledOrders: {
    id: 'cancelledOrders', unit: 'count', access: 'commercial', axis: 'order',
    durationSensitivity: 'total', cohortSensitive: true, financial: false,
  },
  revenue: {
    id: 'revenue', unit: 'decimal', access: 'commercial', axis: 'order',
    durationSensitivity: 'total', cohortSensitive: true, financial: false,
  },
  revenueEstimated: {
    id: 'revenueEstimated', unit: 'decimal', access: 'commercial', axis: 'order',
    durationSensitivity: 'total', cohortSensitive: true, financial: false,
  },
  adSpend: {
    id: 'adSpend', unit: 'decimal', access: 'commercial', axis: 'order',
    durationSensitivity: 'total', cohortSensitive: false, financial: false,
  },
  deliveryRate: {
    id: 'deliveryRate', unit: 'percent', access: 'commercial', axis: 'order',
    durationSensitivity: 'rate', cohortSensitive: true, financial: false,
  },
  purchaseCost: {
    id: 'purchaseCost', unit: 'decimal', access: 'full', axis: 'order',
    durationSensitivity: 'total', cohortSensitive: true, financial: true,
  },
  deliveryCost: {
    id: 'deliveryCost', unit: 'decimal', access: 'full', axis: 'order',
    durationSensitivity: 'total', cohortSensitive: true, financial: true,
  },
  confirmationCost: {
    id: 'confirmationCost', unit: 'decimal', access: 'full', axis: 'order',
    durationSensitivity: 'total', cohortSensitive: false, financial: true,
  },
  contributionMargin: {
    id: 'contributionMargin', unit: 'decimal', access: 'full', axis: 'order',
    durationSensitivity: 'total', cohortSensitive: true, financial: true,
  },
}

export const ALL_METRICS: readonly KpiMetricAlias[] = Object.keys(METRIC_CATALOG) as KpiMetricAlias[]

/** Sélection par défaut d'une analyse de synthèse. */
export const DEFAULT_METRICS: readonly KpiMetricAlias[] = [
  'totalOrders',
  'deliveredOrders',
  'revenue',
  'adSpend',
  'deliveryRate',
]

/** Sélection orientée rentabilité, uniquement pour un accès `full`. */
export const PROFIT_METRICS: readonly KpiMetricAlias[] = [
  'totalOrders',
  'deliveredOrders',
  'revenue',
  'adSpend',
  'contributionMargin',
  'purchaseCost',
  'deliveryCost',
  'confirmationCost',
]

export function isMetricAllowed(id: KpiMetricAlias, access: MetricAccess): boolean {
  return access === 'full' || METRIC_CATALOG[id].access === 'commercial'
}

/** Métriques publiables pour un niveau d'accès donné. */
export function metricsVisibleFor(access: MetricAccess): KpiMetricAlias[] {
  return ALL_METRICS.filter((id) => isMetricAllowed(id, access))
}

/**
 * Filtre une sélection en conservant **l'ordre demandé**.
 *
 * L'ordre est sémantique : la métrique citée par l'utilisateur doit rester en
 * tête, sinon un plafond d'affichage peut l'évincer. On ne réordonne donc
 * jamais selon le catalogue.
 */
export function restrictMetrics(
  selection: readonly KpiMetricAlias[],
  access: MetricAccess,
): KpiMetricAlias[] {
  const allowed = new Set(metricsVisibleFor(access))
  const result: KpiMetricAlias[] = []
  for (const metric of selection) {
    if (allowed.has(metric) && !result.includes(metric)) result.push(metric)
  }
  return result
}

/* -------------------------------------------------------------------------- */
/* Métriques dérivées : calculées côté serveur, jamais par le modèle           */
/* -------------------------------------------------------------------------- */

export type DerivedMetricId =
  | 'ordersPerDay'
  | 'deliveredPerDay'
  | 'revenuePerDay'
  | 'revenuePerDelivered'

export interface DerivedMetricDefinition {
  id: DerivedMetricId
  unit: MetricUnit
  access: MetricAccess
  /** Métriques sources obligatoires : aucune dérivation sans elles. */
  requires: readonly KpiMetricAlias[]
  /** Normalise une durée : ces indicateurs neutralisent 30 vs 31 jours. */
  normalizesDuration: boolean
}

export const DERIVED_METRICS: Record<DerivedMetricId, DerivedMetricDefinition> = {
  ordersPerDay: {
    id: 'ordersPerDay', unit: 'decimal', access: 'commercial',
    requires: ['totalOrders'], normalizesDuration: true,
  },
  deliveredPerDay: {
    id: 'deliveredPerDay', unit: 'decimal', access: 'commercial',
    requires: ['deliveredOrders'], normalizesDuration: true,
  },
  revenuePerDay: {
    id: 'revenuePerDay', unit: 'decimal', access: 'commercial',
    requires: ['revenue'], normalizesDuration: true,
  },
  revenuePerDelivered: {
    id: 'revenuePerDelivered', unit: 'decimal', access: 'commercial',
    requires: ['revenue', 'deliveredOrders'], normalizesDuration: false,
  },
}

export const ALL_DERIVED_METRICS: readonly DerivedMetricId[] =
  Object.keys(DERIVED_METRICS) as DerivedMetricId[]

/**
 * Dérivées qui neutralisent une différence de durée entre deux fenêtres.
 * Elles accompagnent toujours le total, sans jamais le remplacer.
 */
export function durationNormalizingMetrics(access: MetricAccess): DerivedMetricId[] {
  return ALL_DERIVED_METRICS.filter(
    (id) => DERIVED_METRICS[id].normalizesDuration && isDerivedAllowed(id, access),
  )
}

export function isDerivedAllowed(id: DerivedMetricId, access: MetricAccess): boolean {
  return access === 'full' || DERIVED_METRICS[id].access === 'commercial'
}
