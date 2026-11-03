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
import { divideDecimal, sumDecimalText } from '@/lib/assistant/semantic/decimal'
import { METRIC_CATALOG, DERIVED_METRICS } from '@/lib/assistant/semantic/catalog'
import type { WindowAssessment } from '@/lib/assistant/engine/history'
import type { DimensionReading, WindowReading } from '@/lib/assistant/engine/executor'
import type { AssistantLocale, TextScript } from '@/lib/assistant/semantic/locale'
import { resolveDictionary, translate, type Dictionary } from '@/lib/assistant/blocks/i18n'
import {
  RESPONSE_DOCUMENT_VERSION,
  type ChartBlock,
  type KpiItem,
  type ResponseBlock,
  type ResponseDocument,
  type TableBlock,
  type TableCell,
} from '@/lib/assistant/blocks/types'

/** Longueur maximale d'une série affichable sans agrégation. */
const MAX_SERIES_POINTS = 40
/** Nombre de KPI compacts : au-delà, la réponse devient un mur de chiffres. */
const MAX_KPI_ITEMS = 4
/** Nombre de lignes comparatives publiées. */
const MAX_TABLE_ROWS = 6
/** Nombre de recommandations : trois au maximum, jamais un catalogue. */
const MAX_RECOMMENDATIONS = 3

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

/** Formatage d'une variation, signe explicite. */
export function formatDelta(delta: string | null, unit: 'count' | 'decimal' | 'percent', currency: string | null): string {
  if (delta === null) return '—'
  const sign = delta.startsWith('-') ? '' : '+'
  const magnitude = delta.startsWith('-') ? delta.slice(1) : delta
  const formatted = formatMetricValue({ value: magnitude, unit, currency })
  return `${sign}${formatted === '—' ? '' : formatted}`
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

/** KPI compacts : uniquement les métriques publiées, quatre au maximum. */
export function buildKpiItems(
  dict: Dictionary,
  reading: WindowReading | undefined,
  metrics: readonly KpiMetricAlias[],
): KpiItem[] {
  const items: KpiItem[] = []
  for (const metric of metrics) {
    if (items.length >= MAX_KPI_ITEMS) break
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
}

/** Clés de réserve localisées, dédupliquées et dans un ordre stable. */
export function describeReserves(dict: Dictionary, deltas: readonly MetricDeltaResult[]): string[] {
  const order = [
    'reason.access_denied',
    'reason.definition_differs',
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

/** Différence d'affichage entre deux décimaux textuels. */
function subtractForDisplay(current: string, baseline: string): string | null {
  const diff = Number(current) - Number(baseline)
  if (!Number.isFinite(diff)) return null
  return diff.toFixed(2)
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

  for (const delta of input.deltas) {
    if (rows.length >= MAX_TABLE_ROWS) break
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
  if (needsNormalization && rows.length < MAX_TABLE_ROWS) {
    const perDay: Array<{ derived: 'ordersPerDay' | 'revenuePerDay'; metric: KpiMetricAlias }> = [
      { derived: 'ordersPerDay', metric: 'totalOrders' },
      { derived: 'revenuePerDay', metric: 'revenue' },
    ]
    for (const entry of perDay) {
      if (rows.length >= MAX_TABLE_ROWS) break
      const currentValue = readDerivedValue(input.currentReading, entry.metric, entry.derived, input.currentDays)
      const baselineValue = readDerivedValue(input.baselineReading, entry.metric, entry.derived, input.baselineDays)
      if (currentValue === null && baselineValue === null) continue
      const unit = DERIVED_METRICS[entry.derived].unit
      const currency = entry.metric === 'revenue' ? input.currency : null
      const delta = currentValue !== null && baselineValue !== null
        ? subtractForDisplay(currentValue, baselineValue)
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
    caption: reserves.length > 0 ? reserves[0] : undefined,
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
/* Assemblage du document                                                     */
/* -------------------------------------------------------------------------- */

export interface ComposeInput {
  request: AnalysisRequest
  readings: Map<string, WindowReading>
  assessments: Map<string, WindowAssessment>
  deltas: readonly MetricDeltaResult[]
  primaryPair: { currentId: string; baselineId: string } | null
  dimensions: readonly DimensionReading[]
  currency: string | null
  budgetExceeded?: boolean
}

export interface ComposedResponse {
  document: ResponseDocument
  warnings: string[]
  kpiItems: KpiItem[]
  table: TableBlock | null
  chart: ChartBlock | null
  /** Texte de repli : recherche et copie, sans dupliquer les blocs chiffrés. */
  text: string
}

/** Recommandations strictement adossées à un fait publié. */
function buildRecommendations(input: {
  dict: Dictionary
  deltas: readonly MetricDeltaResult[]
  currentReading?: WindowReading
  currency: string | null
}): string[] {
  const { dict } = input
  const items: string[] = []

  const deliveryRate = input.deltas.find((delta) => delta.metric === 'deliveryRate')
  const delivered = deliveryRate?.current ?? readMetricFromReading(input.currentReading, 'deliveryRate').value
  if (delivered !== null && delivered !== undefined) {
    const numeric = Number(delivered)
    if (Number.isFinite(numeric) && numeric > 0 && numeric < 100) {
      items.push(translate(dict, 'reco.deliveryRate', { value: `${delivered} %` }))
    }
  }

  const adSpend = readMetricFromReading(input.currentReading, 'adSpend')
  const revenue = readMetricFromReading(input.currentReading, 'revenue')
  if (adSpend.value !== null && revenue.value !== null && input.currency) {
    items.push(translate(dict, 'reco.ads', {
      value: formatMetricValue({ value: adSpend.value, unit: 'decimal', currency: input.currency }),
      revenue: formatMetricValue({ value: revenue.value, unit: 'decimal', currency: input.currency }),
    }))
  }

  const orders = input.deltas.find((delta) => delta.metric === 'totalOrders')
  if (orders?.delta && orders.direction && orders.direction !== 'flat') {
    const key = orders.direction === 'up' ? 'reco.ordersSpike' : 'reco.ordersDrop'
    items.push(translate(dict, key, { delta: formatDelta(orders.delta, 'count', null) }))
  }

  return items.slice(0, MAX_RECOMMENDATIONS)
}

/** Constats qualitatifs : aucun chiffre, ils vivent déjà dans les blocs. */
function buildInsights(input: {
  dict: Dictionary
  deltas: readonly MetricDeltaResult[]
  currentLabel: string
  baselineLabel: string
}): string[] {
  const items: string[] = []
  const ranked = input.deltas
    .filter((delta) => delta.delta !== null && delta.direction !== null)
    .slice(0, 2)

  for (const delta of ranked) {
    const label = metricLabel(input.dict, delta.metric)
    if (delta.direction === 'flat') {
      items.push(translate(input.dict, 'verdict.equal', { metric: label }))
      continue
    }
    const better = delta.direction === 'up' &&
      // Une hausse n'est pas toujours favorable : les annulations et retours
      // se lisent à l'envers.
      !isNegativeMetric(delta.metric)
    items.push(translate(input.dict, better ? 'verdict.better' : 'verdict.worse', {
      period: better ? input.currentLabel : input.baselineLabel,
      metric: label,
    }))
  }
  return items
}

function isNegativeMetric(metric: KpiMetricAlias): boolean {
  return metric === 'cancelledOrders' || metric === 'returnedOrders' ||
    metric === 'adSpend' || metric === 'purchaseCost' ||
    metric === 'deliveryCost' || metric === 'confirmationCost'
}

/** Notices : réserves de comparaison + qualification d'absence + budget. */
function buildNotices(input: ComposeInput, dict: Dictionary): string[] {
  const notices: string[] = [...describeReserves(dict, input.deltas)]

  for (const assessment of input.assessments.values()) {
    if (assessment.kind === 'known' || assessment.kind === 'coverage_partial') continue
    const key = `absence.${absenceSuffix(assessment.kind)}`
    const message = translate(dict, key)
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
 * - comparaison exploitable → tableau (jamais doublé par des badges KPI) ;
 * - période simple avec série suffisante → KPI compacts + graphique ;
 * - sinon → réponse courte, texte et notice uniquement.
 */
export function composeDocument(input: ComposeInput): ComposedResponse {
  const { request } = input
  const dict = resolveDictionary(request.profile.locale, request.profile.script)
  const script = request.profile.script

  const currentId = input.primaryPair?.currentId ?? request.plan.periods[0]?.id ?? null
  const baselineId = input.primaryPair?.baselineId ?? null
  const currentPeriod = request.plan.periods.find((period) => period.id === currentId) ??
    request.plan.groups.find((period) => period.id === currentId) ?? null
  const baselinePeriod = baselineId
    ? request.plan.periods.find((period) => period.id === baselineId) ??
      request.plan.groups.find((period) => period.id === baselineId) ?? null
    : null

  const currentLabel = currentPeriod ? formatPeriodLabel(currentPeriod, request.profile.locale) : ''
  const baselineLabel = baselinePeriod ? formatPeriodLabel(baselinePeriod, request.profile.locale) : ''

  const currentReading = currentId ? input.readings.get(currentId) : undefined
  const baselineReading = baselineId ? input.readings.get(baselineId) : undefined
  const currentDays = currentPeriod ? periodDays(currentPeriod) : 0
  const baselineDays = baselinePeriod ? periodDays(baselinePeriod) : 0

  const blocks: ResponseBlock[] = []
  const warnings = buildNotices(input, dict)

  // 1. Tableau comparatif : prioritaire dès qu'un écart est interprétable.
  const table = baselinePeriod
    ? buildComparisonTable({
        dict,
        script,
        deltas: input.deltas,
        currentLabel,
        baselineLabel,
        currentReading,
        baselineReading,
        currentDays,
        baselineDays,
        currency: input.currency,
      })
    : null

  // 2. KPI compacts : jamais en doublon d'un tableau couvrant les mêmes valeurs.
  const kpiItems = table ? [] : buildKpiItems(dict, currentReading, request.metrics)

  // 3. Graphique : uniquement pour une période simple et une série réelle.
  const chart = (!baselinePeriod && request.needsSeries)
    ? buildChartBlock({ dict, reading: currentReading, titleKey: 'chart.title.orders', series: 'orders' })
    : null

  const insights = baselinePeriod ? buildInsights({ dict, deltas: input.deltas, currentLabel, baselineLabel }) : []
  const recommendations = buildRecommendations({ dict, deltas: input.deltas, currentReading, currency: input.currency })

  const hasFigures = Boolean(table) || kpiItems.length > 0 || Boolean(chart)

  // Résumé : qualitatif, jamais un doublon des chiffres des blocs.
  const summaryText = hasFigures
    ? (baselinePeriod
        ? translate(dict, 'summary.comparison', { current: currentLabel, baseline: baselineLabel })
        : translate(dict, 'summary.single', { period: currentLabel }))
    : warnings[0] ?? translate(dict, 'summary.noFigures')

  blocks.push({ type: 'summary', text: summaryText })
  if (kpiItems.length > 0) blocks.push({ type: 'kpi', items: kpiItems })
  if (table) blocks.push({ type: 'table', table })
  if (chart) blocks.push({ type: 'chart', chart })
  if (insights.length > 0) {
    blocks.push({ type: 'insights', title: translate(dict, 'title.verdict'), items: insights })
  }
  if (recommendations.length > 0) {
    blocks.push({ type: 'recommendations', title: translate(dict, 'title.recommendations'), items: recommendations })
  }
  if (warnings.length > 0) {
    blocks.push({
      type: 'notice',
      severity: 'warning',
      text: warnings[0],
      details: warnings.length > 1 ? warnings.slice(1) : undefined,
    })
  }

  const presentation: ResponseDocument['presentation'] = table
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
  }

  const text = [summaryText, ...insights].filter(Boolean).join(' ')

  return {
    document,
    warnings,
    kpiItems,
    table,
    chart,
    text,
  }
}
