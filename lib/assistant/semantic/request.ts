/**
 * Interprétation structurée d'une demande métier.
 *
 * `AnalysisRequest` est le contrat unique entre l'interprétation, le plan
 * d'opérations et la restitution. Il conserve **toutes** les périodes citées,
 * les métriques autorisées, les dimensions reconnues et le profil de langue.
 *
 * Aucun module en aval ne relit le message brut : une seule interprétation fait
 * foi, ce qui supprime les divergences entre la route et l'agent.
 */
import type { BusinessRange } from '@/lib/dashboard/business-time'
import { businessTodayIso, businessDateParts } from '@/lib/dashboard/business-time'
import type { AssistantIntent } from '@/lib/assistant/types'
import type { KpiMetricAlias } from '@/lib/assistant/analytics-contract'
import {
  DEFAULT_METRICS,
  PROFIT_METRICS,
  restrictMetrics,
  type MetricAccess,
} from '@/lib/assistant/semantic/catalog'
import {
  assignYears,
  buildPeriodPlan,
  comparisonPeriodPlan,
  monthMentions,
  resolveRelativeYears,
  singlePeriodPlan,
  yearMentions,
  type PeriodPlan,
} from '@/lib/assistant/semantic/periods'
import { detectCommunicationProfile, type CommunicationProfile } from '@/lib/assistant/semantic/locale'

export type AnalysisDimension =
  | 'city'
  | 'product'
  | 'confirmation'
  | 'agent'
  | 'status'
  | 'campaign'
  | 'expense'
  | 'stock'
  | 'delivery'
  | 'supplier'

export interface AnalysisClarification {
  /** Clé localisée, jamais une phrase codée en dur. */
  key: 'clarify.period'
}

export interface AnalysisRequest {
  question: string
  intent: AssistantIntent
  profile: CommunicationProfile
  plan: PeriodPlan
  metrics: KpiMetricAlias[]
  /** Indicateurs explicitement nommés par l'utilisateur, dans l'ordre du texte. */
  requestedMetrics: KpiMetricAlias[]
  dimensions: AnalysisDimension[]
  access: MetricAccess
  /** Série journalière réellement utile (tendance, pas un total). */
  needsSeries: boolean
  /** « Bénéfice net » demandé : indicateur non défini, à expliquer explicitement. */
  netProfitRequested: boolean
  clarification: AnalysisClarification | null
}

/**
 * Vocabulaire de dimensions. Ce n'est pas un scénario par question : chaque
 * entrée désigne une capacité du catalogue, plusieurs dimensions peuvent être
 * demandées dans le même message.
 */
const DIMENSION_VOCABULARY: ReadonlyArray<{ dimension: AnalysisDimension; pattern: RegExp }> = [
  { dimension: 'city', pattern: /(?:villes?|city|cities|مدن|مدينة|المدن|المدينة)/i },
  { dimension: 'product', pattern: /(?:produits?|articles?|products?|items?|منتوج|منتجات|المنتجات)/i },
  { dimension: 'agent', pattern: /(?:agents?|staff|employees?|موظف|الموظف|الوكلاء|وكيل)/i },
  { dimension: 'confirmation', pattern: /(?:confirm|تأكيد|التأكيد|أكد)/i },
  { dimension: 'campaign', pattern: /(?:campagnes?|campaigns?|الحملة|حملات)/i },
  { dimension: 'expense', pattern: /(?:dépenses?|depenses?|charges?|expenses?|مصاريف|المصاريف)/i },
  { dimension: 'stock', pattern: /(?:stock|inventory|مخزون|المخزون)/i },
  { dimension: 'delivery', pattern: /(?:livraison|transporteur|delivery|shipping|توصيل|التوصيل)/i },
  { dimension: 'supplier', pattern: /(?:fournisseur|suppliers?|vendor|مورد|المورد)/i },
  { dimension: 'status', pattern: /(?:statuts?|status(?:es)?|حالة|الحالات)/i },
]

/**
 * Vocabulaire d'indicateurs : un mot reconnu désigne une métrique du catalogue,
 * jamais un scénario. La langue ne change pas la capacité, seulement les mots.
 */
const METRIC_VOCABULARY: ReadonlyArray<{ metric: KpiMetricAlias; pattern: RegExp }> = [
  { metric: 'revenueEstimated', pattern: /(?:ca estim|chiffre d.affaires estim|estimated revenue|الرقم المقدر)/i },
  { metric: 'revenue', pattern: /(?:chiffre d.affaires?|\bca\b|revenus?|revenue|sales|turnover|الرقم|المبيعات|مداخيل)/i },
  { metric: 'deliveryRate', pattern: /(?:taux de livraison|delivery rate|نسبة التسليم|معدل التسليم)/i },
  { metric: 'deliveredOrders', pattern: /(?:livr[ée]es?|delivered|deliveries|تسليم|مسلمة|مسلم)/i },
  { metric: 'returnedOrders', pattern: /(?:retours?|returned|returns?|مرتجع|إرجاع)/i },
  { metric: 'cancelledOrders', pattern: /(?:annul[ée]?es?|cancell?ed|ملغاة|إلغاء)/i },
  { metric: 'adSpend', pattern: /(?:publicit[ée]|adspend|ads?\b|ad spend|marketing spend|إعلان|الإعلانات)/i },
  { metric: 'contributionMargin', pattern: /(?:marge|margin|profitability|هامش|الهامش)/i },
  { metric: 'purchaseCost', pattern: /(?:co[uû]t d.achat|purchase cost|cogs|تكلفة الشراء)/i },
  { metric: 'deliveryCost', pattern: /(?:co[uû]t de livraison|shipping cost|delivery cost|تكلفة التوصيل)/i },
  { metric: 'confirmationCost', pattern: /(?:co[uû]t de confirmation|confirmation cost|تكلفة التأكيد)/i },
  { metric: 'totalOrders', pattern: /(?:commandes?|orders?|طلبات|الطلبات)/i },
]

const SERIES_REQUEST = /(?:tendance|évolution|evolution|chaque jour|par jour|quotidien|courbe|graphique|trend|daily|over time|اتجاه|تطور|كل يوم|يومي|رسم)/i
const PROFIT_REQUEST = /(?:marge|marges|profit|rentabilité|rentabilite|bénéfice|benefice|margin|هامش|الهامش|ربح)/i
/** Bénéfice net : indicateur non défini par le contrat V5 (voir notice dédiée). */
const NET_PROFIT_REQUEST = /(?:b[ée]n[ée]fice\s+net|profit\s+net|net\s+profit|صافي\s+الربح|الربح\s+الصافي)/i
const COMPARISON_INTENT = /(?:compar|versus|\bvs\b|contre|par rapport|compared|compare|قارن|مقارنة|بالمقارنة)/i

/** Indicateurs explicitement nommés, dans l'ordre du texte. */
export function detectMetrics(message: string): KpiMetricAlias[] {
  const text = String(message ?? '')
  const found: Array<{ metric: KpiMetricAlias; index: number }> = []
  for (const entry of METRIC_VOCABULARY) {
    const match = entry.pattern.exec(text)
    if (!match) continue
    if (found.some((item) => item.metric === entry.metric)) continue
    found.push({ metric: entry.metric, index: match.index })
  }
  return found.sort((a, b) => a.index - b.index).map((item) => item.metric)
}

export function isComparisonIntent(message: string): boolean {
  return COMPARISON_INTENT.test(String(message ?? ''))
}

export function detectDimensions(message: string): AnalysisDimension[] {
  const text = String(message ?? '')
  const found: AnalysisDimension[] = []
  for (const entry of DIMENSION_VOCABULARY) {
    if (entry.pattern.test(text) && !found.includes(entry.dimension)) found.push(entry.dimension)
  }
  return found
}

export interface BuildAnalysisRequestInput {
  message: string
  intent: AssistantIntent
  /** Période déjà résolue par l'interprétation existante. */
  resolvedRange: BusinessRange
  /** Paire relative explicite, si l'interprétation en a trouvé une. */
  resolvedComparison?: { current: BusinessRange; baseline: BusinessRange } | null
  access: MetricAccess
  maxPeriods: number
  /** Clarification demandée par l'interprétation (période non résolue). */
  clarificationRequired?: boolean
  now?: Date
}

function addOneDay(day: string): string {
  const parsed = new Date(`${day}T00:00:00.000Z`)
  parsed.setUTCDate(parsed.getUTCDate() + 1)
  return parsed.toISOString().slice(0, 10)
}

/** Fenêtre annuelle bornée à la journée courante pour l'année en cours. */
function yearWindow(year: number, fallback: BusinessRange, now: Date): BusinessRange {
  const today = businessTodayIso(now)
  const start = `${year}-01-01`
  const end = `${year + 1}-01-01`
  if (year === businessDateParts(now).year) {
    return { from: start, to: addOneDay(today) }
  }
  return start < end ? { from: start, to: end } : fallback
}

/**
 * Construit la demande structurée.
 *
 * Priorité d'interprétation des périodes :
 * 1. mois et années nommés → plan multi-périodes (conserve toutes les fenêtres) ;
 * 2. paire relative explicite → plan comparatif ;
 * 3. période résolue simple.
 */
export function buildAnalysisRequest(input: BuildAnalysisRequestInput): AnalysisRequest {
  const now = input.now ?? new Date()
  const message = String(input.message ?? '')
  const profile = detectCommunicationProfile(message)
  const currentYear = businessDateParts(now).year

  const months = monthMentions(message)
  const years = yearMentions(message)
  const relativeYears = resolveRelativeYears(message, currentYear)
  const comparisonIntent = isComparisonIntent(message)

  let plan: PeriodPlan
  if (months.length > 0) {
    const fallbackYear = years.length > 0 ? years[0].year : currentYear
    plan = buildPeriodPlan({
      months: assignYears(months, years, fallbackYear),
      maxPeriods: input.maxPeriods,
      comparisonIntent,
    })
  } else if (relativeYears.length >= 2) {
    plan = comparisonPeriodPlan(
      yearWindow(relativeYears[0], input.resolvedRange, now),
      yearWindow(relativeYears[1], input.resolvedRange, now),
    )
  } else if (input.resolvedComparison) {
    plan = comparisonPeriodPlan(input.resolvedComparison.current, input.resolvedComparison.baseline)
  } else {
    plan = singlePeriodPlan(input.resolvedRange)
  }

  const wantsProfit = PROFIT_REQUEST.test(message)
  const requestedMetrics = detectMetrics(message)
  const base = wantsProfit ? PROFIT_METRICS : DEFAULT_METRICS
  // Un indicateur explicitement demandé passe en tête : le plafond d'affichage
  // ne peut plus évincer la métrique qui a motivé la question.
  const selection = [
    ...requestedMetrics,
    ...base.filter((metric) => !requestedMetrics.includes(metric)),
  ]
  const restricted = restrictMetrics(selection, input.access)

  return {
    question: message,
    intent: input.intent,
    profile,
    plan,
    metrics: restricted.length > 0 ? restricted : restrictMetrics(DEFAULT_METRICS, input.access),
    requestedMetrics: restrictMetrics(requestedMetrics, input.access),
    dimensions: detectDimensions(message),
    access: input.access,
    needsSeries: SERIES_REQUEST.test(message) || plan.kind === 'single',
    netProfitRequested: NET_PROFIT_REQUEST.test(message),
    clarification: input.clarificationRequired ? { key: 'clarify.period' } : null,
  }
}

/** Toutes les fenêtres à lire, groupes compris, sans doublon de bornes. */
export function planWindows(plan: PeriodPlan): Array<{ id: string; range: BusinessRange }> {
  const windows: Array<{ id: string; range: BusinessRange }> = []
  for (const period of [...plan.periods, ...plan.groups]) {
    if (windows.some((entry) => entry.range.from === period.range.from && entry.range.to === period.range.to)) {
      continue
    }
    windows.push({ id: period.id, range: period.range })
  }
  return windows
}

export function findPeriodById(plan: PeriodPlan, id: string) {
  return [...plan.periods, ...plan.groups].find((period) => period.id === id) ?? null
}
