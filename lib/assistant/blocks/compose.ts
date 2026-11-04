/**
 * Composition de la réponse à partir de faits vérifiés.
 *
 * Principes :
 * - un fait n'apparaît que là où il est le plus lisible (tableau, KPI ou
 *   graphique), jamais dupliqué dans le texte ;
 * - le format est choisi selon la demande : tableau pour une comparaison,
 *   graphique pour une tendance, réponse courte sinon ;
 * - les réserves sont regroupées en une notice discrète, jamais un écran de
 *   diagnostics ;
 * - tout texte est localisé via le catalogue, aucune phrase codée en dur.
 */
import type { KpiMetricAlias } from '@/lib/assistant/analytics-contract'
import { KPI_METRIC_ALIASES, type AnalyticsState } from '@/lib/assistant/analytics-contract'
import type { AnalysisRequest } from '@/lib/assistant/semantic/request'
import { periodDays, type AnalysisPeriod } from '@/lib/assistant/semantic/periods'
import type { MetricDeltaResult } from '@/lib/assistant/semantic/comparability'
import { divideDecimal, sumDecimalText, subtractDecimalText, compareDecimalText } from '@/lib/assistant/semantic/decimal'
import { percentOfCounts } from '@/lib/assistant/analytics-decimal'
import { METRIC_CATALOG, DERIVED_METRICS } from '@/lib/assistant/semantic/catalog'
import type { WindowAssessment } from '@/lib/assistant/engine/history'
import type { DimensionReading, WindowReading } from '@/lib/assistant/engine/executor'
import type { AssistantLocale, TextScript } from '@/lib/assistant/semantic/locale'
import { resolveDictionary, translate, type Dictionary } from '@/lib/assistant/blocks/i18n'
import { sanitizePublicText } from '@/lib/assistant/blocks/sanitize'
import { validateEvidenceRegistry, type AnalysisEvidence, type EvidenceClaim } from '@/lib/assistant/fact-registry'
import {
  RESPONSE_DOCUMENT_VERSION,
  type ChartBlock,
  type KpiItem,
  type ResponseBlock,
  type ResponseDocument,
  type TableBlock,
  type TableCell,
  type TableColumn,
} from '@/lib/assistant/blocks/types'

/** Longueur maximale d'une série affichable sans agrégation. */
const MAX_SERIES_POINTS = 40
/** Nombre de KPI compacts : au-delà, la réponse devient un mur de chiffres. */
const MAX_KPI_ITEMS = 4
/** Nombre de lignes comparatives publiées. */
const MAX_TABLE_ROWS = 6

const LOCALE_TAGS: Record<AssistantLocale, string> = {
  fr: 'fr-FR',
  ar: 'ar-MA',
  darija: 'ar-MA',
  en: 'en-GB',
}

/** Libellé localisé d'un indicateur. */
export function metricLabel(dict: Dictionary, metric: KpiMetricAlias): string {
  return translate(dict, `metric.${metric}`)
}

export function derivedLabel(dict: Dictionary, derived: string): string {
  return translate(dict, `derived.${derived}`)
}

/** Valeur affichable : unité et devise fournies par le serveur, jamais déduites. */
export function formatMetricValue(input: {
  value: string | null
  unit: 'count' | 'decimal' | 'percent'
  currency: string | null
}): string {
  if (input.value === null) return '—'
  if (input.unit === 'percent') return `${input.value} %`
  if (input.unit === 'decimal' && input.currency) return `${input.value} ${input.currency}`
  return input.value
}

/** Formatage d'une variation, signe explicite et unité correcte. */
export function formatDelta(delta: string | null, unit: 'count' | 'decimal' | 'percent', currency: string | null): string {
  if (delta === null) return '—'
  const negative = delta.startsWith('-') || delta.startsWith('\u2212')
  const magnitude = negative || delta.startsWith('+') ? delta.slice(1) : delta
  const formatted = formatMetricValue({ value: magnitude, unit, currency })
  if (formatted === '—') return '—'
  // Un écart de pourcentage se lit en points : « +3 pts » n'est pas « +3 % ».
  if (unit === 'percent') {
    const zero = /^0(?:[.,]0+)?$/.test(magnitude)
    return zero ? `0 ${translateDeltaPoints()}` : `${negative ? '−' : '+'}${magnitude} ${translateDeltaPoints()}`
  }
  const zero = /^0(?:[.,]0+)?$/.test(magnitude)
  if (zero) return formatted
  return `${negative ? '−' : '+'}${formatted}`
}

/** Unité d'un écart de taux, localisée par le dictionnaire de la réponse. */
function translateDeltaPoints(): string {
  return 'pts'
}

/**
 * Libellé de période, localisé et lisible.
 *
 * Les bornes restent des journées métier : aucune conversion de fuseau n'est
 * faite ici, ce qui évite un décalage d'un jour à l'affichage.
 */
export function formatPeriodLabel(period: AnalysisPeriod, locale: AssistantLocale): string {
  const tag = LOCALE_TAGS[locale]
  const monthName = (month: number, year: number) => {
    const date = new Date(Date.UTC(year, month - 1, 1))
    return new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
  }

  if (period.months.length === 1) {
    return monthName(period.months[0].month, period.months[0].year)
  }
  if (period.months.length > 1) {
    const sorted = [...period.months].sort((a, b) => a.month - b.month)
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const firstDate = new Date(Date.UTC(first.year, first.month - 1, 1))
    const lastDate = new Date(Date.UTC(last.year, last.month - 1, 1))
    const firstShort = new Intl.DateTimeFormat(tag, { month: 'long', timeZone: 'UTC' }).format(firstDate)
    const lastLabel = new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(lastDate)
    return `${firstShort} – ${lastLabel}`
  }

  // Fenêtre non calendaire : bornes explicites.
  const from = new Date(`${period.range.from}T00:00:00.000Z`)
  const toExclusive = new Date(`${period.range.to}T00:00:00.000Z`)
  toExclusive.setUTCDate(toExclusive.getUTCDate() - 1)
  const format = (date: Date) =>
    new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
  if (periodDays(period) <= 1) return format(from)
  return `${format(from)} → ${format(toExclusive)}`
}

/** Cellule numérique : toujours LTR, quelle que soit la langue de la réponse. */
function numericCell(value: string): TableCell {
  return { value, direction: 'ltr' }
}

function textCell(value: string, script: TextScript): TableCell {
  return { value, direction: script === 'arabic' ? 'rtl' : 'ltr' }
}

export type { KpiMetricAlias, MetricDeltaResult, WindowAssessment, WindowReading, DimensionReading }

/* -------------------------------------------------------------------------- */
/* Extraction de valeurs vérifiées                                            */
/* -------------------------------------------------------------------------- */

export interface MetricSnapshot {
  value: string | null
  unit: 'count' | 'decimal' | 'percent'
  state: AnalyticsState
  currency: string | null
}

/**
 * Agrège une métrique sur le périmètre d'une fenêtre.
 *
 * Aucune somme inter-devises : si les boutiques n'ont pas la même devise, la
 * valeur n'est pas publiée. Une seule métrique non publiable rend la métrique
 * entière non publiable — jamais une somme partielle présentée comme un total.
 */
export function readMetricFromReading(
  reading: WindowReading | undefined,
  metric: KpiMetricAlias,
): MetricSnapshot {
  const unit = METRIC_CATALOG[metric].unit
  const empty: MetricSnapshot = { value: null, unit, state: 'missing', currency: null }
  if (!reading?.kpis || reading.kpis.stores.length === 0) return empty

  const kpis = reading.kpis
  const currencies = new Set(kpis.stores.map((store) => store.currency))
  const currency = currencies.size === 1 ? Array.from(currencies)[0] : null
  if (unit === 'decimal' && currency === null) {
    return { ...empty, state: 'partial' }
  }

  const name = KPI_METRIC_ALIASES[metric]
  const values: string[] = []
  let worst: AnalyticsState = 'complete'

  // Un taux ne s'additionne JAMAIS : il se recalcule sur les numérateurs et
  // dénominateurs. Deux boutiques à 0/10 et 90/100 donnent 81,82 %, pas 90 %.
  if (unit === 'percent') {
    let numerator = 0
    let denominator = 0
    for (const store of kpis.stores) {
      const metricValue = store.metrics[name]
      if (!metricValue || metricValue.state === 'missing' ||
          metricValue.state === 'forbidden' || metricValue.state === 'unavailable') {
        return { value: null, unit, state: metricValue?.state ?? 'missing', currency }
      }
      if (metricValue.numerator === null || metricValue.denominator === null) {
        return { value: null, unit, state: 'partial', currency }
      }
      numerator += metricValue.numerator
      denominator += metricValue.denominator
      if (metricValue.state === 'partial' && worst === 'complete') worst = 'partial'
    }
    const value = percentOfCounts(numerator, denominator)
    return { value, unit, state: value === null ? 'partial' : worst, currency }
  }

  for (const store of kpis.stores) {
    const metricValue = store.metrics[name]
    if (!metricValue || metricValue.value === null ||
        metricValue.state === 'missing' || metricValue.state === 'forbidden' ||
        metricValue.state === 'unavailable') {
      return { value: null, unit, state: metricValue?.state ?? 'missing', currency }
    }
    if (metricValue.state === 'partial' && worst === 'complete') worst = 'partial'
    values.push(metricValue.value)
  }

  if (unit === 'count') {
    const total = values.reduce((sum, value) => sum + Number(value), 0)
    return { value: String(total), unit, state: worst, currency }
  }

  return { value: sumDecimalText(values), unit, state: worst, currency }
}

/** Valeur dérivée (par jour, par livrée) calculée côté serveur. */
export function readDerivedValue(
  reading: WindowReading | undefined,
  metric: KpiMetricAlias,
  derived: 'ordersPerDay' | 'revenuePerDay' | 'deliveredPerDay' | 'revenuePerDelivered',
  days: number,
): string | null {
  const snapshot = readMetricFromReading(reading, metric)
  if (snapshot.value === null) return null
  if (derived === 'revenuePerDelivered') {
    const delivered = readMetricFromReading(reading, 'deliveredOrders')
    if (delivered.value === null || Number(delivered.value) === 0) return null
    return divideDecimal(snapshot.value, Number(delivered.value), 2)
  }
  if (days <= 0) return null
  return divideDecimal(snapshot.value, days, 2)
}

/**
 * KPI compacts : uniquement les métriques publiées.
 *
 * Le plafond est **adaptatif** : il ne peut jamais être inférieur au nombre
 * d'indicateurs explicitement demandés, sinon une demande (« CA, commandes,
 * livrées, annulées et retournées ») perdrait une métrique en silence.
 */
export function buildKpiItems(
  dict: Dictionary,
  reading: WindowReading | undefined,
  metrics: readonly KpiMetricAlias[],
  options?: { max?: number; requested?: readonly KpiMetricAlias[] },
): KpiItem[] {
  const requested = options?.requested ?? []
  const limit = Math.max(MAX_KPI_ITEMS, requested.length, Math.trunc(options?.max ?? 0))
  // Ordre de priorité : demandes explicites → reste de la sélection.
  const ordered = [
    ...metrics.filter((metric) => requested.includes(metric)),
    ...metrics.filter((metric) => !requested.includes(metric)),
  ]
  const items: KpiItem[] = []
  for (const metric of ordered) {
    if (items.length >= limit) break
    const snapshot = readMetricFromReading(reading, metric)
    if (snapshot.value === null) continue
    items.push({
      id: metric,
      label: metricLabel(dict, metric),
      value: formatMetricValue({ value: snapshot.value, unit: snapshot.unit, currency: snapshot.currency }),
      state: snapshot.state === 'partial' ? 'partial' : 'value',
    })
  }
  return items
}

/* -------------------------------------------------------------------------- */
/* Tableau comparatif                                                         */
/* -------------------------------------------------------------------------- */

export interface ComparisonTableInput {
  dict: Dictionary
  script: TextScript
  deltas: readonly MetricDeltaResult[]
  currentLabel: string
  baselineLabel: string
  currentReading?: WindowReading
  baselineReading?: WindowReading
  currentDays: number
  baselineDays: number
  currency: string | null
  /** Indicateurs explicitement demandés : jamais évincés par le plafond. */
  requestedMetrics?: readonly KpiMetricAlias[]
  /** Plafond explicite ; le plafond effectif reste au moins le nombre demandé. */
  maxRows?: number
  /** Titre du bloc (comparaison courante), déjà localisé par l'appelant. */
  title?: string
}

/** Clés de réserve localisées, dédupliquées et dans un ordre stable. */
export function describeReserves(dict: Dictionary, deltas: readonly MetricDeltaResult[]): string[] {
  const order = [
    'reason.access_denied',
    'reason.definition_differs',
    'reason.cohort_immature',
    'reason.coverage_partial',
    'reason.duration_differs',
    'reason.stale',
    'reason.metric_missing',
  ]
  const present = new Set<string>()
  for (const delta of deltas) {
    for (const reason of delta.comparability.reasons) present.add(reason)
  }

  const messages: string[] = []
  for (const key of order) {
    if (!present.has(key)) continue
    const first = deltas.find((delta) => delta.comparability.reasons.includes(key as never))
    const message = translate(dict, key, {
      currentDays: first?.comparability.daysCurrent ?? 0,
      baselineDays: first?.comparability.daysBaseline ?? 0,
    })
    if (message && !messages.includes(message)) messages.push(message)
  }
  return messages
}

/**
 * Construit le tableau de comparaison.
 *
 * - une ligne par indicateur réellement publié d'un côté au moins ;
 * - l'écart reste vide (`—`) lorsque la comparabilité ne l'autorise pas ;
 * - des lignes normalisées par jour sont ajoutées lorsque les durées diffèrent,
 *   sans jamais masquer les totaux.
 */
export function buildComparisonTable(input: ComparisonTableInput): TableBlock | null {
  const rows: TableBlock['rows'] = []
  const requested = input.requestedMetrics ?? []
  const limit = Math.max(MAX_TABLE_ROWS, requested.length, Math.trunc(input.maxRows ?? 0))
  // Les indicateurs demandés passent en tête : un plafond ne peut donc jamais
  // évincer la métrique qui a motivé la question.
  const ordered = [
    ...input.deltas.filter((delta) => requested.includes(delta.metric)),
    ...input.deltas.filter((delta) => !requested.includes(delta.metric)),
  ]

  for (const delta of ordered) {
    if (rows.length >= limit) break
    if (delta.current === null && delta.baseline === null) continue
    const unit = METRIC_CATALOG[delta.metric].unit
    const currency = unit === 'decimal' ? input.currency : null
    rows.push({
      key: delta.metric,
      cells: [
        textCell(metricLabel(input.dict, delta.metric), input.script),
        numericCell(formatMetricValue({ value: delta.current, unit, currency })),
        numericCell(formatMetricValue({ value: delta.baseline, unit, currency })),
        numericCell(formatDelta(delta.delta, unit, currency)),
      ],
    })
  }

  // Durées différentes : un total brut n'est pas interprétable seul.
  const needsNormalization = input.deltas.some((delta) => delta.comparability.needsDurationNormalization)
  if (needsNormalization && rows.length < limit) {
    const perDay: Array<{ derived: 'ordersPerDay' | 'revenuePerDay'; metric: KpiMetricAlias }> = [
      { derived: 'ordersPerDay', metric: 'totalOrders' },
      { derived: 'revenuePerDay', metric: 'revenue' },
    ]
    // Une dérivée n'est comparable que si sa métrique source l'est : sinon un
    // écart serait publié alors que le total reste côte à côte.
    const sourceComparable = (metric: KpiMetricAlias): boolean => {
      const source = input.deltas.find((delta) => delta.metric === metric)
      if (!source) return false
      return source.comparability.decision === 'comparable' ||
        source.comparability.decision === 'comparable_with_reserve'
    }
    for (const entry of perDay) {
      if (rows.length >= limit) break
      if (!sourceComparable(entry.metric)) continue
      const currentValue = readDerivedValue(input.currentReading, entry.metric, entry.derived, input.currentDays)
      const baselineValue = readDerivedValue(input.baselineReading, entry.metric, entry.derived, input.baselineDays)
      if (currentValue === null && baselineValue === null) continue
      const unit = DERIVED_METRICS[entry.derived].unit
      const currency = entry.metric === 'revenue' ? input.currency : null
      const delta = currentValue !== null && baselineValue !== null
        ? subtractDecimalText(currentValue, baselineValue)
        : null
      rows.push({
        key: entry.derived,
        cells: [
          textCell(derivedLabel(input.dict, entry.derived), input.script),
          numericCell(formatMetricValue({ value: currentValue, unit, currency })),
          numericCell(formatMetricValue({ value: baselineValue, unit, currency })),
          numericCell(formatDelta(delta, unit, currency)),
        ],
      })
    }
  }

  if (rows.length === 0) return null

  const reserves = describeReserves(input.dict, input.deltas)

  return {
    title: input.title,
    columns: [
      {
        key: 'metric',
        label: translate(input.dict, 'table.indicator'),
        direction: input.script === 'arabic' ? 'rtl' : 'ltr',
        align: 'start',
      },
      { key: 'current', label: input.currentLabel, direction: 'ltr', align: 'end' },
      { key: 'baseline', label: input.baselineLabel, direction: 'ltr', align: 'end' },
      { key: 'delta', label: translate(input.dict, 'table.delta'), direction: 'ltr', align: 'end' },
    ],
    rows,
    caption: reserves.length > 0 ? reserves.join(' · ') : undefined,
  }
}

/* -------------------------------------------------------------------------- */
/* Graphique                                                                  */
/* -------------------------------------------------------------------------- */

export interface ChartInput {
  dict: Dictionary
  reading?: WindowReading
  titleKey: 'chart.title.daily' | 'chart.title.orders' | 'chart.title.revenue'
  series: 'orders' | 'revenue'
}

/**
 * Graphique uniquement lorsqu'il apporte une information supplémentaire :
 * au moins trois journées complètes, une seule boutique et une seule devise.
 * Une série courte ou incomplète reste dans le tableau ou le texte.
 */
export function buildChartBlock(input: ChartInput): ChartBlock | null {
  const kpis = input.reading?.kpis
  if (!kpis || kpis.stores.length !== 1) return null
  const store = kpis.stores[0]
  const days = store.days ?? []
  if (days.length < 3 || days.length > MAX_SERIES_POINTS) return null

  const complete = days.filter((day) => day.state === 'complete' || day.state === 'empty')
  if (complete.length < 3) return null

  const points: ChartBlock['points'] = []
  for (const day of complete) {
    if (input.series === 'orders') {
      if (day.orders === null) continue
      points.push({ x: day.date, values: { orders: day.orders } })
    } else {
      if (day.revenue === null) continue
      const numeric = Number(day.revenue)
      if (!Number.isFinite(numeric)) continue
      points.push({ x: day.date, values: { revenue: numeric } })
    }
  }
  if (points.length < 3) return null

  return {
    kind: 'line',
    title: translate(input.dict, input.titleKey),
    unit: input.series === 'revenue' ? 'currency' : 'count',
    series: [{
      key: input.series,
      label: translate(input.dict, input.series === 'revenue' ? 'chart.revenue' : 'chart.orders'),
    }],
    points,
  }
}

/* -------------------------------------------------------------------------- */
/* Dimensions réellement lues                                                 */
/* -------------------------------------------------------------------------- */

/** Colonnes maximales d'une table de dimension. */
export const MAX_DIMENSION_COLUMNS = 4
/** Lignes maximales publiées pour une dimension (budget de lecture : 20). */
export const MAX_DIMENSION_ROWS = 6
/** Tables de dimension maximales dans une réponse. */
export const MAX_DIMENSION_TABLES = 3

/** Clés de dimension dont la valeur est un montant (devise à afficher). */
const MONEY_KEYS: ReadonlySet<string> = new Set([
  'revenue', 'profit', 'commission', 'potential', 'earned', 'paid',
  'totalRevenue', 'purchaseCost', 'deliveryCost', 'confirmationCost', 'contributionMargin',
])

/** Valeur d'une cellule de dimension : unité ajoutée seulement si elle est connue. */
export function formatDimensionValue(key: string, value: unknown, currency: string | null): string {
  if (value === null || value === undefined) return '—'
  const text = String(value)
  if (currency && MONEY_KEYS.has(key) && /^[+\-−]?\d/.test(text)) return `${text} ${currency}`
  return text
}

/**
 * Table d'une dimension réellement lue (ville, produit, agent, statut…).
 *
 * Les colonnes sont déduites des clés que le catalogue sait nommer : une clé
 * inconnue est ignorée plutôt que publiée en identifiant technique. Aucune
 * valeur n'est recomposée ici, elles viennent toutes de la section validée.
 */
export function buildDimensionTable(input: {
  dict: Dictionary
  script: TextScript
  reading: DimensionReading
  /** Période réellement lue (les ventilations portent sur la fenêtre courante). */
  periodLabel?: string
  currency?: string | null
}): TableBlock | null {
  const section = input.reading.data
  const rows = Array.isArray(section?.rows) ? section!.rows : []
  if (rows.length === 0) return null

  const labelFor = (key: string): string => {
    const dimension = translate(input.dict, `dim.${key}`)
    if (dimension) return dimension
    return translate(input.dict, `metric.${key}`)
  }

  const columns: TableColumn[] = []
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  for (const key of keys) {
    const value = rows.map((row) => row[key]).find((entry) => entry !== null && entry !== undefined)
    if (value === undefined || typeof value === 'object') continue
    const label = labelFor(key)
    if (!label) continue
    const numeric = typeof value === 'number' || /^[+\-−]?\d/.test(String(value).trim())
    columns.push({
      key,
      label,
      direction: numeric ? 'ltr' : (input.script === 'arabic' ? 'rtl' : 'ltr'),
      align: numeric ? 'end' : 'start',
    })
    if (columns.length >= MAX_DIMENSION_COLUMNS) break
  }
  if (columns.length === 0) return null

  const body = rows.slice(0, MAX_DIMENSION_ROWS).map((row, index) => {
    const record = row as Record<string, unknown>
    return {
      key: String(record.id ?? `${input.reading.dimension}-${index}`),
      cells: columns.map((column) => {
        const text = formatDimensionValue(column.key, record[column.key], input.currency ?? null)
        return { value: text, direction: column.direction } as TableCell
      }),
    }
  })

  const baseTitle = translate(input.dict, `dim.title.${input.reading.dimension}`)
  const title = baseTitle && input.periodLabel ? `${baseTitle} · ${input.periodLabel}` : baseTitle

  const captions: string[] = []
  if (section?.meta?.state === 'partial') captions.push(translate(input.dict, 'absence.partial'))
  if (rows.length > body.length) captions.push(`${body.length} / ${rows.length}`)
  // Une réserve de définition ou de classement accompagne toujours son tableau.
  const sectionLimits = section?.meta?.limits ?? []
  if (input.script === 'latin' && input.dict === resolveDictionary('fr', 'latin')) {
    for (const limit of sectionLimits) {
      const text = sanitizePublicText(limit).text
      if (text) captions.push(text)
    }
  } else if (sectionLimits.length > 0) {
    captions.push(translate(input.dict, 'limit.dimensionSubset'))
  }
  if (columns.some((column) => column.key === 'profit')) captions.push(translate(input.dict, 'limit.productProfit'))
  return {
    title,
    columns,
    rows: body,
    caption: captions.length > 0 ? captions.join(' · ') : undefined,
  }
}

/** Libellé de section comparative : « septembre 2026 vs septembre 2025 ». */
function sectionTitle(dict: Dictionary, currentLabel: string, baselineLabel: string): string {
  return translate(dict, 'title.comparisonPair', { current: currentLabel, baseline: baselineLabel })
}

/* -------------------------------------------------------------------------- */
/* Assemblage du document                                                     */
/* -------------------------------------------------------------------------- */

export interface ComparisonSection {
  currentId: string
  baselineId: string
  deltas: readonly MetricDeltaResult[]
}

export interface ComposeInput {
  request: AnalysisRequest
  readings: Map<string, WindowReading>
  assessments: Map<string, WindowAssessment>
  /** Toutes les comparaisons demandées, dans l'ordre du plan. */
  sections: readonly ComparisonSection[]
  dimensions: readonly DimensionReading[]
  currency: string | null
  budgetExceeded?: boolean
}

export interface ComposedResponse {
  document: ResponseDocument
  warnings: string[]
  kpiItems: KpiItem[]
  /** Premier tableau publié (compatibilité) ; `tables` contient tout. */
  table: TableBlock | null
  tables: TableBlock[]
  chart: ChartBlock | null
  /** Texte de repli : recherche et copie, sans dupliquer les blocs chiffrés. */
  text: string
}

/** Une seule collecte pour les tableaux, les raisonnements et les recommandations. */
export function buildAnalysisEvidence(input: ComposeInput): AnalysisEvidence[] {
  const facts: AnalysisEvidence[] = []
  for (const [windowId, reading] of input.readings) {
    if (!reading.kpis || reading.failure) continue
    const stores = reading.kpis.stores
    for (const metric of input.request.metrics) {
      const snapshot = readMetricFromReading(reading, metric)
      if (snapshot.value === null) continue
      facts.push({
        id: `${windowId}:metric:${metric}`, kind: 'metric', metric, value: snapshot.value,
        unit: snapshot.unit, currency: snapshot.currency, storeIds: stores.map((store) => store.storeId),
        windowId, range: reading.range, population: 'order_cohort', state: snapshot.state,
        axis: 'order', definition: `${metric}; versions=${stores.map((store) => store.definitionVersion).join(',')}`,
        numerator: snapshot.unit === 'percent' && stores.length === 1 ? stores[0].metrics[KPI_METRIC_ALIASES[metric]]?.numerator : null,
        denominator: snapshot.unit === 'percent' && stores.length === 1 ? stores[0].metrics[KPI_METRIC_ALIASES[metric]]?.denominator : null,
        coverage: stores.map((store) => ({ storeId: store.storeId, ...store.coverage })),
        provenance: [reading.kpis.source], parents: [], reserves: reading.kpis.limits ?? [],
      })
    }
    const days = stores.length === 1 ? stores[0].days ?? [] : []
    for (const day of input.request.needsSeries && days.length <= MAX_SERIES_POINTS ? days : []) {
      for (const [metric, value] of [['totalOrders', day.orders], ['revenue', day.revenue]] as const) {
        if (value === null || (day.state !== 'complete' && day.state !== 'empty')) continue
        facts.push({
          id: `${windowId}:series:${metric}:${day.date}`, kind: 'series', metric, value: String(value),
          unit: metric === 'revenue' ? 'decimal' : 'count', currency: metric === 'revenue' ? stores[0].currency : null,
          storeIds: [stores[0].storeId], windowId, range: { from: day.date, to: new Date(Date.parse(`${day.date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) },
          population: 'order_cohort', state: day.state, coverage: { date: day.date, state: day.state },
          axis: 'order', definition: `${metric}; version=${stores[0].definitionVersion}`,
          provenance: [reading.kpis.source], parents: [], reserves: [],
        })
      }
    }
  }
  for (const section of input.sections) {
    for (const delta of section.deltas) {
      const current = facts.find((fact) => fact.id === `${section.currentId}:metric:${delta.metric}`)
      const baseline = facts.find((fact) => fact.id === `${section.baselineId}:metric:${delta.metric}`)
      if (!current || !baseline || delta.delta === null || delta.direction === null) continue
      facts.push({ ...current,
        id: `${section.currentId}:${section.baselineId}:delta:${delta.metric}`, kind: 'comparison',
        value: delta.delta, direction: delta.direction, baselineWindowId: section.baselineId,
        coverage: { current: current.coverage, baseline: baseline.coverage },
        parents: [current.id, baseline.id], reserves: delta.comparability.reasons,
      })
    }
  }
  for (const reading of input.dimensions) {
    const section = reading.data
    const window = input.readings.get(reading.windowId)
    if (!section || reading.failure || !window?.kpis || !['complete', 'partial', 'empty'].includes(section.meta.state)) continue
    const kpis = window.kpis
    if (section.meta.range && (section.meta.range.from !== window.range.from || section.meta.range.to !== window.range.to)) {
      throw new Error('ASSISTANT_EVIDENCE_SCOPE_MISMATCH')
    }
    if (section.meta.access && Object.keys(section.meta.access).some((storeId) => !kpis.stores.some((store) => store.storeId === storeId))) {
      throw new Error('ASSISTANT_EVIDENCE_SCOPE_MISMATCH')
    }
    section.rows.slice(0, 20).forEach((row, index) => {
      const member = String(row.productName ?? row.city ?? row.agentName ?? row.name ?? index)
      const memberId = String(row.productId ?? row.agentId ?? row.id ?? row.city ?? member)
      for (const [metric, value] of Object.entries(row)) {
        if (value === null || value === undefined || !/^-?\d+(?:\.\d+)?$/.test(String(value))) continue
        if (/id$/i.test(metric) || !translate(resolveDictionary(input.request.profile.locale, input.request.profile.script), `dim.${metric}`) &&
            !Object.prototype.hasOwnProperty.call(METRIC_CATALOG, metric)) continue
        const money = MONEY_KEYS.has(metric)
        if (money && kpis.stores.some((store) => store.access !== 'full')) continue
        if (money && !input.currency) continue
        facts.push({
          id: `${reading.windowId}:${reading.dimension}:${index}:${metric}`, kind: 'dimension', metric,
          value: String(value), unit: money ? 'decimal' : /rate/i.test(metric) ? 'percent' : 'count',
          currency: money ? input.currency : null, storeIds: kpis.stores.map((store) => store.storeId),
          windowId: reading.windowId, range: section.meta.range ?? window.range,
          population: reading.dimension === 'product' ? 'ranked_subset' : reading.dimension === 'status' ? 'sample' : 'dimension_population',
          state: section.meta.state, coverage: { window: kpis.stores.map((store) => store.coverage),
            section: { state: section.meta.state, consistency: section.meta.consistency ?? [], limits: section.meta.limits ?? [] } },
          provenance: [section.meta.source || reading.dimension], parents: [],
          axis: 'order', definition: `${section.meta.section ?? reading.dimension}:${metric}; contract=${section.meta.contractVersion ?? 'unknown'}`,
          dimension: reading.dimension, member, memberId, reserves: [...section.meta.limits ?? [], ...section.meta.notices ?? []],
        })
      }
    })
  }
  for (const section of input.sections) {
    const currentFacts = facts.filter((fact) => fact.kind === 'dimension' && fact.windowId === section.currentId && fact.state === 'complete')
    for (const current of currentFacts) {
      const baseline = facts.find((fact) => fact.kind === 'dimension' && fact.windowId === section.baselineId &&
        fact.dimension === current.dimension && fact.memberId === current.memberId && fact.metric === current.metric && fact.state === 'complete')
      if (!baseline || baseline.currency !== current.currency) continue
      const value = subtractDecimalText(current.value, baseline.value)
      const order = value === null ? null : compareDecimalText(value, '0')
      if (value === null || order === null) continue
      facts.push({ ...current, id: `${current.id}:vs:${baseline.id}`, kind: 'comparison', value,
        baselineWindowId: section.baselineId, parents: [current.id, baseline.id],
        direction: order > 0 ? 'up' : order < 0 ? 'down' : 'flat',
        coverage: { current: current.coverage, baseline: baseline.coverage },
        provenance: [...new Set([...current.provenance, ...baseline.provenance])],
      })
    }
  }
  if (!validateEvidenceRegistry(facts)) throw new Error('ASSISTANT_EVIDENCE_INVALID')
  return facts
}

/** Catalogue de phrases prouvées : le modèle choisit et ordonne, sans inventer. */
export function buildEvidenceClaims(facts: readonly AnalysisEvidence[], request: Pick<AnalysisRequest, 'profile' | 'plan'>): EvidenceClaim[] {
  const dict = resolveDictionary(request.profile.locale, request.profile.script)
  const claims: EvidenceClaim[] = []
  const label = (fact: AnalysisEvidence) => metricLabel(dict, fact.metric as KpiMetricAlias) ||
    translate(dict, `dim.${fact.metric}`) || fact.metric
  const period = (id: string) => {
    const found = [...request.plan.periods, ...request.plan.groups].find((entry) => entry.id === id)
    return found ? formatPeriodLabel(found, request.profile.locale) : ''
  }
  for (const fact of facts) {
    if (fact.kind === 'metric' && fact.metric === 'revenue') {
      const costs = ['purchaseCost', 'deliveryCost', 'confirmationCost', 'adSpend'].map((metric) =>
        facts.find((entry) => entry.kind === 'metric' && entry.windowId === fact.windowId && entry.metric === metric))
      const margin = facts.find((entry) => entry.kind === 'metric' && entry.windowId === fact.windowId && entry.metric === 'contributionMargin')
      if (margin?.state === 'complete' && fact.state === 'complete' && costs.every((cost) => cost && cost.state === 'complete' && cost.currency === fact.currency)) {
        const total = sumDecimalText(costs.map((cost) => cost!.value))
        const calculated = total === null ? null : subtractDecimalText(fact.value, total)
        if (calculated !== null && subtractDecimalText(calculated, margin.value)?.replace(/[-.0]/g, '') === '') {
          claims.push({ kind: 'decomposition', evidenceIds: [fact.id, ...costs.map((cost) => cost!.id), margin.id],
            text: translate(dict, 'analysis.decomposition', { period: period(fact.windowId),
              revenue: formatMetricValue(fact), margin: formatMetricValue(margin) }) })
        }
      }
    }
    if (fact.kind === 'comparison') {
      claims.push({ kind: 'trend', evidenceIds: [fact.id], text:
        `${period(fact.windowId)} / ${period(fact.baselineWindowId!)}${fact.member ? ` · ${fact.member}` : ''} — ${translate(dict, `narrative.${fact.direction}`, { metric: label(fact) })}${fact.population !== 'order_cohort' ? ` ${translate(dict, 'limit.dimensionSubset')}` : ''}` })
      if (fact.direction !== 'flat') claims.push({ kind: 'hypothesis', evidenceIds: [fact.id], text:
        translate(dict, 'analysis.hypothesis', { metric: label(fact), period: period(fact.windowId) }) })
    }
    if (fact.kind === 'dimension') {
      claims.push({ kind: 'fact', evidenceIds: [fact.id], text:
        `${period(fact.windowId)} · ${fact.member} — ${label(fact)} : ${formatMetricValue(fact)}. ${translate(dict, 'limit.dimensionSubset')}` })
    }
    if (fact.kind === 'metric' && fact.metric === 'deliveryRate' && Number(fact.value) < 100) {
      claims.push({ kind: 'recommendation', evidenceIds: [fact.id], text:
        `${period(fact.windowId)} — ${translate(dict, 'reco.deliveryRate', { value: formatMetricValue(fact) })}` })
    }
  }
  return claims.filter((claim) => Boolean(claim.text))
}

/** Le contrat publié est vérifié avant la finalisation financière. */
export function validateDocumentEvidence(document: ResponseDocument): boolean {
  if (!document.evidence || !validateEvidenceRegistry(document.evidence)) return false
  const ids = new Set(document.evidence.map((fact) => fact.id))
  const allowedClaims = document.analysis ? buildEvidenceClaims(document.evidence, {
    profile: { locale: document.locale, script: document.script, direction: document.direction },
    plan: document.analysis.periodPlan,
  }) : []
  const valid = (refs: readonly string[] | undefined) => Boolean(refs?.length) && refs!.every((id) => ids.has(id))
  const matchingValue = (text: string, refs: readonly string[] | undefined) => valid(refs) && refs!.some((id) => {
    const fact = document.evidence!.find((entry) => entry.id === id)!
    const clean = text.replace(/−/g, '-').replace(/^\+/, '')
    const raw = fact.value.replace(/^-0(?:\.0+)?$/, '0')
    return clean === raw || clean === `${raw} %` || clean === `${raw} pts` || clean === `${raw} ${fact.currency}`
  })
  if (document.evidence.some((fact) => fact.kind === 'comparison' && (() => {
    const [current, baseline] = fact.parents.map((id) => document.evidence!.find((entry) => entry.id === id)!)
    const value = subtractDecimalText(current.value, baseline.value)
    const order = value === null ? null : compareDecimalText(value, '0')
    return value === null || subtractDecimalText(value, fact.value)?.replace(/[-.0]/g, '') !== '' ||
      current.metric !== baseline.metric || current.currency !== baseline.currency ||
      current.windowId !== fact.windowId || baseline.windowId !== fact.baselineWindowId ||
      JSON.stringify(current.storeIds) !== JSON.stringify(baseline.storeIds) ||
      fact.direction !== (order === 0 ? 'flat' : order === 1 ? 'up' : 'down')
  })())) return false
  if (document.evidence.some((fact) => fact.kind === 'derived' && (() => {
    const parents = fact.parents.map((id) => document.evidence!.find((entry) => entry.id === id)!)
    const normalized = parents.map((parent) => divideDecimal(parent.value, periodDays({
      id: parent.windowId, range: parent.range, months: [], granularity: 'day', year: null, aggregated: false,
    }), 2))
    if (normalized.some((value) => value === null)) return true
    const expected = normalized.length === 1 ? normalized[0] : normalized.length === 2
      ? subtractDecimalText(normalized[0]!, normalized[1]!) : null
    return expected === null || subtractDecimalText(expected, fact.value)?.replace(/[-.0]/g, '') !== ''
  })())) return false
  return document.blocks.every((block) => {
    if (block.type === 'notice' || block.type === 'clarification') return true
    if (!valid(block.evidenceIds)) return false
    if (block.type === 'insights' || block.type === 'recommendations') return false
    if (block.type === 'summary') {
      if (!document.analysis) return false
      // Réponse agent : résumé libre, mais sans aucun chiffre et borné. Les
      // valeurs restent exclusivement dans les blocs vérifiés.
      if (document.analysis.agent === true) {
        return block.text.trim().length > 0 && block.text.length <= 260 && !/\d/.test(block.text)
      }
      const dict = resolveDictionary(document.locale, document.script)
      const plan = document.analysis.periodPlan
      const all = [...plan.periods, ...plan.groups]
      const label = (id: string) => {
        const period = all.find((entry) => entry.id === id)
        return period ? formatPeriodLabel(period, document.locale) : ''
      }
      const expected = plan.pairs.length > 1
        ? translate(dict, 'summary.comparisons', { count: String(plan.pairs.length) })
        : plan.pairs.length === 1
          ? translate(dict, 'summary.comparison', { current: label(plan.pairs[0].currentId), baseline: label(plan.pairs[0].baselineId) })
          : translate(dict, 'summary.single', { period: label(plan.periods[0]?.id ?? '') })
      return block.text === expected || block.text === translate(dict, 'summary.noFigures')
    }
    if (block.type === 'analysis') return block.claims.every((claim) => {
      if (!valid(claim.evidenceIds)) return false
      // Réponse agent : seules les hypothèses et recommandations portent du
      // texte libre. Elles restent étiquetées, sans chiffre, adossées à une
      // preuve réelle. La validation ne prétend pas comprendre la phrase.
      if (document.analysis?.agent === true &&
        (claim.kind === 'hypothesis' || claim.kind === 'recommendation')) {
        return claim.text.trim().length > 0 && claim.text.length <= 200 && !/\d/.test(claim.text)
      }
      return allowedClaims.some((allowed) => allowed.kind === claim.kind && allowed.text === claim.text &&
        JSON.stringify(allowed.evidenceIds) === JSON.stringify(claim.evidenceIds))
    })
    // Un KPI doit être prouvé par la métrique qu'il affiche : une valeur
    // identique pour un autre indicateur ne valide jamais l'item.
    if (block.type === 'kpi') return block.items.every((item) => matchingValue(item.value, item.evidenceIds) &&
      (item.evidenceIds ?? []).some((id) => {
        const fact = document.evidence!.find((entry) => entry.id === id)
        return Boolean(fact) && fact!.metric === item.id
      }))
    if (block.type === 'table') return block.table.rows.every((row) => row.cells.every((cell, index) =>
      index === 0 || cell.value === '—' || !/^[+−-]?\d/.test(cell.value) || matchingValue(cell.value, cell.evidenceIds)))
    if (block.type === 'chart') return block.chart.points.every((point) => valid(point.evidenceIds) &&
      Object.values(point.values).every((value) => value === null || point.evidenceIds!.some((id) =>
        Number(document.evidence!.find((fact) => fact.id === id)!.value) === value)))
    return true
  })
}

/** Notices : réserves de comparaison + qualification d'absence + limites. */
function buildNotices(input: ComposeInput, dict: Dictionary): string[] {
  const notices: string[] = []

  // Réserves de TOUTES les comparaisons publiées, dédupliquées.
  for (const section of input.sections) {
    for (const message of describeReserves(dict, section.deltas)) {
      if (message && !notices.includes(message)) notices.push(message)
    }
  }

  for (const assessment of input.assessments.values()) {
    if (assessment.kind === 'known' || assessment.kind === 'coverage_partial') continue
    const key = `absence.${absenceSuffix(assessment.kind)}`
    const message = translate(dict, key)
    if (message && !notices.includes(message)) notices.push(message)
  }

  // Un indicateur explicitement demandé et non publiable doit être expliqué :
  // le remplacer silencieusement par un autre serait une réponse trompeuse.
  const primary = input.sections[0]
  if (primary) {
    const reading = input.readings.get(primary.currentId)
    for (const metric of input.request.requestedMetrics) {
      const delta = primary.deltas.find((item) => item.metric === metric)
      const published = delta
        ? delta.current !== null || delta.baseline !== null
        : readMetricFromReading(reading, metric).value !== null
      if (published) continue
      const message = translate(dict, 'limit.metricUnavailable', { metric: metricLabel(dict, metric) })
      if (message && !notices.includes(message)) notices.push(message)
    }
  }

  if (input.request.netProfitRequested) {
    const message = translate(dict, 'limit.netProfit')
    if (message && !notices.includes(message)) notices.push(message)
  }

  if (input.dimensions.some((reading) => reading.failure !== null ||
      reading.data?.meta.state === 'unavailable' || reading.data?.meta.state === 'forbidden' ||
      reading.data?.meta.state === 'missing')) {
    const message = translate(dict, 'limit.dimensionUnavailable')
    if (message && !notices.includes(message)) notices.push(message)
  }

  if (input.budgetExceeded) {
    const message = translate(dict, 'absence.budget')
    if (message && !notices.includes(message)) notices.push(message)
  }

  return notices
}

function absenceSuffix(kind: string): string {
  switch (kind) {
    case 'genuinely_empty': return 'empty'
    case 'no_coverage': return 'no_coverage'
    case 'coverage_partial': return 'partial'
    case 'source_unavailable': return 'unavailable'
    case 'range_rejected': return 'range'
    case 'access_denied': return 'access'
    case 'budget_exceeded': return 'budget'
    default: return 'unknown'
  }
}

/**
 * Compose la réponse finale.
 *
 * Le format découle de la demande :
 * - comparaisons exploitables → un tableau PAR comparaison demandée (aucune
 *   période n'est supprimée), puis les ventilations réellement lues ;
 * - période simple avec série suffisante → KPI compacts + graphique ;
 * - sinon → réponse courte, texte et notice uniquement.
 */
export function composeDocument(input: ComposeInput): ComposedResponse {
  const { request } = input
  const evidence = buildAnalysisEvidence(input)
  const dict = resolveDictionary(request.profile.locale, request.profile.script)
  const script = request.profile.script

  const findPeriod = (id: string | null) =>
    id
      ? request.plan.periods.find((period) => period.id === id) ??
        request.plan.groups.find((period) => period.id === id) ?? null
      : null

  const tables: TableBlock[] = []
  const sectionLabels: Array<{ currentLabel: string; baselineLabel: string }> = []

  // 1. Une comparaison par paire demandée : rien n'est fusionné ni supprimé.
  for (const section of input.sections) {
    const currentPeriod = findPeriod(section.currentId)
    const baselinePeriod = findPeriod(section.baselineId)
    if (!currentPeriod || !baselinePeriod) continue
    const currentLabel = formatPeriodLabel(currentPeriod, request.profile.locale)
    const baselineLabel = formatPeriodLabel(baselinePeriod, request.profile.locale)
    sectionLabels.push({ currentLabel, baselineLabel })
    const table = buildComparisonTable({
      dict,
      script,
      deltas: section.deltas,
      currentLabel,
      baselineLabel,
      currentReading: input.readings.get(section.currentId),
      baselineReading: input.readings.get(section.baselineId),
      currentDays: periodDays(currentPeriod),
      baselineDays: periodDays(baselinePeriod),
      currency: input.currency,
      title: sectionTitle(dict, currentLabel, baselineLabel),
      requestedMetrics: request.requestedMetrics,
      maxRows: request.requestedMetrics.length,
    })
    if (table) {
      for (const row of table.rows) {
        row.cells.forEach((cell, index) => {
          if (index === 0 || cell.value === '—') return
          const windowId = index === 2 ? section.baselineId : section.currentId
          let fact = evidence.find((entry) => entry.id === (index === 3
            ? `${section.currentId}:${section.baselineId}:delta:${row.key}` : `${windowId}:metric:${row.key}`))
          // Les lignes normalisées sont calculées depuis une valeur exacte et
          // le nombre de jours, jamais corroborées par leur seul texte affiché.
          if (!fact && row.key.endsWith('PerDay')) {
            const metric = row.key === 'ordersPerDay' ? 'totalOrders' : 'revenue'
            const parents = index === 3
              ? [section.currentId, section.baselineId].flatMap((id) => evidence.filter((entry) => entry.windowId === id && entry.kind === 'metric' && entry.metric === metric))
              : evidence.filter((entry) => entry.id === `${windowId}:metric:${metric}`)
            const currentPeriod = findPeriod(section.currentId)!
            const baselinePeriod = findPeriod(section.baselineId)!
            const current = parents.find((entry) => entry.windowId === section.currentId)
            const baseline = parents.find((entry) => entry.windowId === section.baselineId)
            const parent = parents[0]
            const value = index === 3 && current && baseline
              ? subtractDecimalText(divideDecimal(current.value, periodDays(currentPeriod), 2)!, divideDecimal(baseline.value, periodDays(baselinePeriod), 2)!)
              : parent ? divideDecimal(parent.value, periodDays(findPeriod(windowId)!), 2) : null
            if (parent && value !== null) {
              fact = { ...parent, id: `${section.currentId}:${section.baselineId}:${index}:${row.key}`, kind: 'derived', value,
                parents: parents.map((entry) => entry.id), metric: row.key }
              evidence.push(fact)
            }
          }
          cell.evidenceIds = fact ? [fact.id] : []
        })
      }
      tables.push(table)
    }
  }

  // 2. Ventilations réellement demandées et lues : elles doivent être visibles.
  // La période courante est résolue MÊME sans comparaison : une question simple
  // (« ma marge ce mois-ci ») doit publier ses KPI, pas un « aucune donnée ».
  const primary = input.sections[0]
  const fallbackPeriod = request.plan.periods[0] ?? null
  const primaryCurrentPeriod = primary
    ? findPeriod(primary.currentId)
    : fallbackPeriod
  const currentLabel = primaryCurrentPeriod
    ? formatPeriodLabel(primaryCurrentPeriod, request.profile.locale)
    : ''
  const currentReading = primaryCurrentPeriod
    ? input.readings.get(primaryCurrentPeriod.id)
    : undefined

  const dimensionTables: TableBlock[] = []
  let dimensionsTruncated = false
  for (const reading of input.dimensions) {
    if (reading.failure) continue
    if (dimensionTables.length >= MAX_DIMENSION_TABLES) {
      dimensionsTruncated = true
      break
    }
    const table = buildDimensionTable({
      dict,
      script,
      reading,
      periodLabel: findPeriod(reading.windowId)
        ? formatPeriodLabel(findPeriod(reading.windowId)!, request.profile.locale)
        : currentLabel,
      currency: input.currency,
    })
    if (table) {
      table.rows.forEach((row, rowIndex) => row.cells.forEach((cell, columnIndex) => {
        const key = table.columns[columnIndex].key
        const fact = evidence.find((entry) => entry.id === `${reading.windowId}:${reading.dimension}:${rowIndex}:${key}`)
        if (fact) cell.evidenceIds = [fact.id]
      }))
      dimensionTables.push(table)
    }
  }

  // 3. KPI compacts : publiés dès qu'aucune comparaison ne porte déjà les
  // valeurs. Une ventilation ne remplace jamais le total global : demander
  // « CA et détail par ville » doit afficher le CA global ET le détail.
  const requestedSet = new Set(request.requestedMetrics)
  const kpiRequested = request.requestedMetrics.filter(
    (metric) => !tables.some((table) => table.rows.some((row) => row.key === metric)),
  )
  const kpiMetrics = tables.length > 0
    ? []
    : [
        ...kpiRequested,
        ...request.metrics.filter((metric) => !requestedSet.has(metric)),
      ]
  const kpiItems = buildKpiItems(dict, currentReading, kpiMetrics, {
    requested: request.requestedMetrics,
    max: Math.max(MAX_KPI_ITEMS, request.requestedMetrics.length),
  })
  for (const item of kpiItems) item.evidenceIds = [`${primaryCurrentPeriod?.id}:metric:${item.id}`]

  // 4. Graphique : uniquement pour une période simple et une série réelle.
  const chart = (tables.length === 0 && request.needsSeries)
    ? buildChartBlock({
        dict, reading: currentReading,
        titleKey: request.requestedMetrics.includes('revenue') ? 'chart.title.revenue' : 'chart.title.orders',
        series: request.requestedMetrics.includes('revenue') ? 'revenue' : 'orders',
      })
    : null
  if (chart) for (const point of chart.points) point.evidenceIds = [
    `${primaryCurrentPeriod?.id}:series:${chart.series[0].key === 'revenue' ? 'revenue' : 'totalOrders'}:${point.x}`,
  ]

  const hasFigures = tables.length > 0 || dimensionTables.length > 0 ||
    kpiItems.length > 0 || Boolean(chart)

  // Résumé : qualitatif, jamais un doublon des chiffres des blocs.
  const summaryText = hasFigures
    ? (sectionLabels.length > 0
        ? sectionLabels.length === 1
          ? translate(dict, 'summary.comparison', { current: sectionLabels[0].currentLabel, baseline: sectionLabels[0].baselineLabel })
          : translate(dict, 'summary.comparisons', { count: String(sectionLabels.length) })
        : translate(dict, 'summary.single', { period: currentLabel }))
    : translate(dict, 'summary.noFigures')

  const warnings = buildNotices(input, dict)

  // Aucune demande explicite ne peut disparaître à cause d'un plafond : ce qui
  // n'est pas publié est signalé dans la langue de l'utilisateur.
  const publishedMetrics = new Set<string>([
    ...kpiItems.map((item) => item.id),
    ...tables.flatMap((table) => table.rows.map((row) => row.key)),
  ])
  for (const metric of request.requestedMetrics) {
    if (publishedMetrics.has(metric)) continue
    const message = translate(dict, 'limit.metricUnavailable', { metric: metricLabel(dict, metric) })
    if (message && !warnings.includes(message)) warnings.push(message)
  }
  if (kpiMetrics.length > kpiItems.length && kpiItems.length > 0) {
    const message = translate(dict, 'limit.kpiTruncated', {
      kept: String(kpiItems.length),
      total: String(kpiMetrics.length),
    })
    if (message && !warnings.includes(message)) warnings.push(message)
  }
  const visibleDeltas = input.sections.reduce((sum, section) => sum
    + section.deltas.filter((delta) => delta.current !== null || delta.baseline !== null).length, 0)
  const publishedRows = tables.reduce((sum, table) => sum + table.rows.length, 0)
  if (publishedRows > 0 && visibleDeltas > publishedRows) {
    const message = translate(dict, 'limit.tableRowsTruncated', {
      kept: String(publishedRows),
      total: String(visibleDeltas),
    })
    if (message && !warnings.includes(message)) warnings.push(message)
  }

  // Une capacité demandée et volontairement réduite doit être annoncée, jamais
  // supprimée en silence.
  const renderableDimensions = input.dimensions.filter((reading) => !reading.failure).length
  const notRead = input.dimensions.filter((reading) => !reading.failure && !reading.data).length
  if (dimensionsTruncated || notRead > 0) {
    const message = translate(dict, 'limit.dimensionsTruncated', {
      kept: String(dimensionTables.length),
      total: String(renderableDimensions),
    })
    if (message && !warnings.includes(message)) warnings.push(message)
  }
  if (dimensionTables.length > 0 && input.sections.length > 1) {
    const message = translate(dict, 'limit.dimensionScope', { period: currentLabel })
    if (message && !warnings.includes(message)) warnings.push(message)
  }
  const blocks: ResponseBlock[] = []
  blocks.push({ type: 'summary', text: summaryText })
  if (kpiItems.length > 0) blocks.push({ type: 'kpi', items: kpiItems })
  for (const table of tables) blocks.push({ type: 'table', table })
  for (const table of dimensionTables) blocks.push({ type: 'table', table })
  if (chart) blocks.push({ type: 'chart', chart })
  if (warnings.length > 0) {
    blocks.push({
      type: 'notice',
      severity: 'warning',
      text: warnings[0],
      details: warnings.length > 1 ? warnings.slice(1) : undefined,
    })
  }

  const presentation: ResponseDocument['presentation'] = tables.length > 0 || dimensionTables.length > 0
    ? 'table'
    : chart && kpiItems.length > 0
      ? 'mixed'
      : chart
        ? 'chart'
        : 'short'

  const document: ResponseDocument = {
    version: RESPONSE_DOCUMENT_VERSION,
    locale: request.profile.locale,
    script,
    direction: request.profile.direction,
    presentation,
    blocks,
    evidence,
    analysis: {
      schema: 1,
      periodPlan: request.plan,
      requestedMetrics: [...request.requestedMetrics],
      requestedDimensions: [...request.dimensions],
      windows: [...input.assessments].map(([id, assessment]) => ({
        id, state: assessment.kind, publishedMetrics: [...assessment.publishedMetrics],
      })),
    },
  }

  // Remplacer les producteurs de conclusions concurrents par le catalogue
  // unique de constats et actions fondés sur les mêmes preuves que les chiffres.
  const claims = buildEvidenceClaims(evidence, request)
  const selected = [
    ...claims.filter((claim) => claim.kind === 'trend').slice(0, 4),
    ...claims.filter((claim) => claim.kind === 'decomposition').slice(0, 1),
    ...['city', 'product', 'agent', 'confirmation', 'status'].flatMap((dimension) =>
      claims.filter((claim) => claim.kind === 'fact' && claim.evidenceIds.some((id) =>
        evidence.find((fact) => fact.id === id)?.dimension === dimension)).slice(0, 1)),
    ...claims.filter((claim) => claim.kind === 'recommendation').slice(0, 2),
  ]
  // Les conclusions ne portent que sur des preuves effectivement publiées
  // dans un bloc chiffré, ou explicitement citées dans l'analyse elle-même.
  if (selected.length) document.blocks.push({ type: 'analysis', title: translate(dict, 'title.verdict'), claims: selected })
  for (const block of document.blocks) {
    if (block.type === 'kpi') block.evidenceIds = block.items.flatMap((item) => item.evidenceIds ?? [])
    else if (block.type === 'table') block.evidenceIds = block.table.rows.flatMap((row) => row.cells.flatMap((cell) => cell.evidenceIds ?? []))
    else if (block.type === 'chart') block.evidenceIds = block.chart.points.flatMap((point) => point.evidenceIds ?? [])
    else if (block.type === 'analysis') block.evidenceIds = block.claims.flatMap((claim) => claim.evidenceIds)
    else if (block.type === 'summary') block.evidenceIds = evidence.map((fact) => fact.id)
  }
  // Les tableaux purement descriptifs (ex. statuts textuels d'un échantillon)
  // ne deviennent pas des preuves d'une métrique. Pas de chiffre non référencé.
  document.blocks = document.blocks.filter((block) => block.type !== 'table' || (block.evidenceIds?.length ?? 0) > 0)
  if (evidence.length > 0 && !validateDocumentEvidence(document)) throw new Error('ASSISTANT_DOCUMENT_UNGROUNDED')

  const text = [summaryText, ...selected.map((claim) => claim.text)].filter(Boolean).join(' ')

  return {
    document,
    warnings,
    kpiItems,
    table: tables[0] ?? dimensionTables[0] ?? null,
    tables: [...tables, ...dimensionTables],
    chart,
    text,
  }
}
