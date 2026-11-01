import { getAssistantProvider } from '@/lib/assistant/providers'
import {
  buildStructuredResponseFromContext,
  parseAssistantLlmOutput,
  sanitizeExplanation,
  sectionState,
  sectionWarnings,
} from '@/lib/assistant/response'
import { collectVerifiedFacts, dedupeMessages, type VerifiedFact } from '@/lib/assistant/fact-registry'
import type { AnalyticsRange, AssistantStructuredResponse } from '@/lib/assistant/types'
import { buildAgentSystemPrompt, buildAgentUserPrompt } from '@/lib/assistant/prompt'
import { buildToolPlan, executeAgentTool, type AgentToolName } from '@/lib/assistant/agent/tools'
import {
  createAssistantAnalyticsSession,
  resolveAssistantBusinessRange,
} from '@/lib/assistant/analytics-reader'
import { resolveComparisonPeriods } from '@/lib/assistant/intents'
import { addBusinessDays, businessTodayIso, type BusinessRange } from '@/lib/dashboard/business-time'
import type {
  AnalyticsMetric,
  AnalyticsState,
  KpiEnvelope,
  SectionResult,
} from '@/lib/assistant/analytics-contract'
import type { AgentStep, RunSecureAgentInput, RunSecureAgentOutput } from '@/lib/assistant/agent/types'

interface TruthMetric {
  value: string | null
  state: AnalyticsState
  unit: 'count' | 'decimal' | 'percent'
}

interface ServerTruth {
  envelopeState: AnalyticsState | 'none'
  currency: string | null
  metrics: Record<string, TruthMetric>
  issues: string[]
  warnings: string[]
}

/**
 * Lecture stricte du contrat V2 : une seule enveloppe KPI, chaque valeur porte
 * son état. Aucune donnée absente, interdite ou indisponible n'est convertie en
 * zéro ; un zéro n'est accepté que si l'état est `empty` ou `complete`.
 */
function readKpiEnvelope(toolData: Record<string, unknown>): KpiEnvelope | null {
  const candidate =
    toolData.getDashboardKPIs ??
    toolData.getProfitSummary ??
    toolData.getAdsSpend ??
    toolData.getOrdersByStatus

  if (!candidate || typeof candidate !== 'object') return null

  const envelope = candidate as { kind?: string; metrics?: unknown }
  if (envelope.kind !== 'kpis' || !envelope.metrics || typeof envelope.metrics !== 'object') return null

  return candidate as KpiEnvelope
}

function toTruthMetric(metric: AnalyticsMetric | null | undefined): TruthMetric | null {
  if (!metric) return null
  return {
    value: metric.state === 'missing' || metric.state === 'forbidden' || metric.state === 'unavailable'
      ? null
      : metric.value,
    state: metric.state,
    unit: metric.unit,
  }
}

function buildServerTruth(toolData: Record<string, unknown>, fallbackCurrency: string): ServerTruth {
  const envelope = readKpiEnvelope(toolData)

  if (!envelope) {
    return {
      envelopeState: 'none',
      currency: fallbackCurrency,
      metrics: {},
      issues: [],
      warnings: [],
    }
  }

  const metrics: Record<string, TruthMetric> = {}
  for (const [alias, metric] of Object.entries(envelope.metrics)) {
    const truthMetric = toTruthMetric(metric as AnalyticsMetric | null | undefined)
    if (truthMetric) metrics[alias] = truthMetric
  }

  // Les réserves génériques (« données partielles », « accès insuffisant »)
  // sont portées par le texte de la réponse : les répéter ici produisait des
  // avertissements doublés. Seules les anomalies et limites précises restent.
  const warnings = [
    ...(envelope.issues ?? []),
    ...(envelope.limits ?? []),
  ]

  return {
    envelopeState: envelope.state,
    currency: envelope.currency ?? null,
    metrics,
    issues: envelope.issues ?? [],
    warnings,
  }
}

const METRIC_LABELS_AR: Record<string, string> = {
  totalOrders: 'الطلبات',
  deliveredOrders: 'الطلبات المسلّمة',
  returnedOrders: 'المرتجعات',
  cancelledOrders: 'الإلغاءات',
  revenue: 'رقم المعاملات المحقق',
  revenueEstimated: 'رقم المعاملات التقديري',
  adSpend: 'مصاريف الإعلانات',
  deliveryRate: 'نسبة التسليم',
  purchaseCost: 'تكلفة الشراء',
  deliveryCost: 'تكلفة التوصيل',
  confirmationCost: 'تكلفة التأكيد',
  contributionMargin: 'الهامش المساهم (بدون المصاريف التشغيلية)',
}

/** Clés trop volumineuses pour le prompt : le serveur les garde pour le rendu. */
const PROMPT_DROP_KEYS = new Set([
  'stores',
  'days',
  'points',
  'coverage',
  'limits',
  'issues',
  'freshness',
  'definitionVersions',
  'revision',
  'lastRebuildAt',
  'timeZone',
])

/** Projection compacte des outils : réduit fortement les tokens facturés. */
function compactForPrompt(value: unknown, depth = 0): unknown {
  if (depth > 6) return null
  if (Array.isArray(value)) return value.slice(0, 5).map((item) => compactForPrompt(item, depth + 1))
  if (!value || typeof value !== 'object') return value

  const source = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(source)) {
    if (PROMPT_DROP_KEYS.has(key)) continue
    if (Array.isArray(item)) {
      out[key] = item.slice(0, 5).map((entry) => compactForPrompt(entry, depth + 1))
      continue
    }
    out[key] = compactForPrompt(item, depth + 1)
  }
  return out
}

/** Suggestions réellement exécutables : jamais une capacité indisponible. */
const UNAVAILABLE_SUGGESTION = /(?:stock|fournisseur|livraison|transporteur|campagne|المخزون|المورد|التوصيل|الحملة)/i

function filterSuggestions(
  list: ReadonlyArray<string> | undefined,
  language: 'fr' | 'ar',
): string[] {
  const cleaned = (list ?? []).filter((item) => item.trim() && !UNAVAILABLE_SUGGESTION.test(item)).slice(0, 4)
  if (cleaned.length > 0) return cleaned
  return language === 'ar'
    ? ['حلل الأداء ديالي', 'وريني المبيعات']
    : ['Analyse mon business', 'Montre-moi mes ventes']
}

const METRIC_LABELS: Record<string, string> = {
  totalOrders: 'Commandes',
  deliveredOrders: 'Commandes livrées',
  returnedOrders: 'Retours',
  cancelledOrders: 'Annulations',
  revenue: 'Chiffre d’affaires réalisé',
  revenueEstimated: 'Chiffre d’affaires estimé',
  adSpend: 'Dépenses publicitaires',
  deliveryRate: 'Taux de livraison',
  purchaseCost: 'Coût d’achat',
  deliveryCost: 'Coût de livraison',
  confirmationCost: 'Coût de confirmation',
  contributionMargin: 'Marge contributive (hors dépenses opérationnelles)',
}

function formatTruthMetric(metric: TruthMetric, currency: string | null, withReserve = true): string {
  const value = metric.value ?? '—'
  const suffix = metric.unit === 'percent' ? ' %' : metric.unit === 'decimal' && currency ? ` ${currency}` : ''
  // La réserve globale (« couverture incomplète ») suffit : la répéter sur
  // chaque ligne alourdissait la réponse sans apporter d'information.
  const reserve = withReserve && metric.state === 'partial' ? ' (partiel)' : ''
  return `${value}${suffix}${reserve}`
}


/**
 * Normalise une borne de période en journée métier `YYYY-MM-DD`.
 *
 * Les périodes mensuelles sont fournies en instants ISO : les passer telles
 * quelles à `addBusinessDays` levait une erreur générique côté réponse.
 * Aucune valeur invalide n'est devinée : `null` force un libellé neutre.
 */
function toBusinessDay(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return null
  const day = businessTodayIso(new Date(parsed))
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

/** Journée métier `YYYY-MM-DD` formatée sans décalage de fuseau. */
function formatDayLabel(day: string, language: 'fr' | 'ar' = 'fr'): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return day
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-MA' : 'fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function capitalize(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatRangeLabel(range: AnalyticsRange, language: 'fr' | 'ar' = 'fr'): string {
  if (typeof range === 'object' && 'start' in range && 'end' in range) {
    const start = toBusinessDay(range.start)
    const end = toBusinessDay(range.end)
    if (!start || !end) return language === 'ar' ? 'الفترة المطلوبة' : 'la période demandée'
    if (end <= start) return formatDayLabel(start, language)
    // `end` est une borne exclue : la dernière journée citée est `end − 1`.
    const lastDay = addBusinessDays(end, -1)
    if (start === lastDay) return formatDayLabel(start, language)
    return language === 'ar'
      ? `من ${formatDayLabel(start, language)} إلى ${formatDayLabel(lastDay, language)}`
      : `du ${formatDayLabel(start, language)} au ${formatDayLabel(lastDay, language)}`
  }
  if (language === 'ar') {
    switch (range) {
      case 'today': return 'اليوم'
      case 'yesterday': return 'البارح'
      case 'week': return 'هاد الأسبوع'
      case 'last_week': return 'الأسبوع لي فات'
      case '7d': return 'آخر 7 أيام'
      case '30d': return 'آخر 30 يوم'
      case 'month': return 'هاد الشهر'
      case 'last_month': return 'الشهر لي فات'
      default: return 'الفترة المطلوبة'
    }
  }
  switch (range) {
    case 'today': return 'aujourd’hui'
    case 'yesterday': return 'hier'
    case 'week': return 'cette semaine'
    case 'last_week': return 'la semaine dernière'
    case '7d': return 'les 7 derniers jours'
    case '30d': return 'les 30 derniers jours'
    case 'month': return 'ce mois-ci'
    case 'last_month': return 'le mois dernier'
    default: return 'la période demandée'
  }
}

/** Trois phrases suffisent : la réponse reste courte et lisible. */
function clampSentences(text: string, max: number): string {
  const trimmed = String(text || '').trim()
  if (!trimmed) return ''
  const sentences = trimmed.split(/(?<=[.!?])\s+/u).filter(Boolean)
  return sentences.length <= max ? trimmed : sentences.slice(0, max).join(' ').trim()
}

function buildTruthMessageText(input: {
  rangeLabel: string
  truth: ServerTruth
  explanation: string
  facts: ReadonlyArray<VerifiedFact>
  language?: 'fr' | 'ar'
  fallbackNotice?: string | null
}): { text: string; rejectedAmounts: string[] } {
  const { rangeLabel, truth, explanation, facts, fallbackNotice } = input
  const language: 'fr' | 'ar' = input.language === 'ar' ? 'ar' : 'fr'
  const t = language === 'ar'
    ? {
        forbidden: 'المعطيات المالية ممنوعة على هاد النطاق. ما كنعرضش أي رقم.',
        unavailable: 'المعطيات اللازمة ما كايناش، وما كنقدمش أي رقم.',
        empty: 'ما كاين حتى طلب مسجل فهاد الفترة (صفر حقيقي).',
        partial: 'التغطية ناقصة: الأرقام كتخص غير الأيام المتوفرة.',
        margin: 'الهامش المساهم ما هوش ربح صافي: المصاريف التشغيلية ما تنقصاتش.',
        noIndicator: 'المعطيات متوفرة ولكن ما قدرتش ننشر المؤشر المطلوب.',
      }
    : {
        forbidden: 'l’accès aux données financières de ce périmètre est refusé. Aucune valeur n’est affichée.',
        unavailable: 'les données nécessaires ne sont pas disponibles, aucun chiffre n’est avancé.',
        empty: 'aucune commande enregistrée sur la période (zéro réel).',
        partial: 'Couverture incomplète : les valeurs publiées ne portent que sur les journées disponibles.',
        margin: 'Marge contributive : les dépenses opérationnelles ne sont pas déduites, ce n’est pas un bénéfice net.',
        noIndicator: 'les données sont disponibles mais aucun indicateur demandé n’a pu être publié.',
      }
  const state = truth.envelopeState
  const scope = capitalize(rangeLabel)

  // Un nombre du texte n'est conservé que si un fait porte sa provenance
  // (boutique, période, devise, unité) et contredit la phrase.
  const clean = sanitizeExplanation(explanation, facts)
  const qualitative = clampSentences(clean.text, 3)

  if (state === 'none') {
    const text = fallbackNotice || qualitative || `${scope} : aucune donnée analytique vérifiable n’est disponible pour cette question.`
    return { text, rejectedAmounts: clean.rejectedAmounts }
  }

  if (state === 'forbidden') {
    return { text: `${scope} : ${t.forbidden}`, rejectedAmounts: [] }
  }

  if (state === 'missing' || state === 'unavailable') {
    const base = `${scope} : ${t.unavailable}`
    return {
      text: qualitative ? `${base} ${qualitative}` : base,
      rejectedAmounts: clean.rejectedAmounts,
    }
  }

  if (state === 'empty') {
    return {
      text: [`${scope} : ${t.empty}`, qualitative]
        .filter(Boolean)
        .join('\n\n'),
      rejectedAmounts: clean.rejectedAmounts,
    }
  }

  const keyFigures: string[] = []
  for (const alias of ['revenue', 'totalOrders', 'deliveredOrders', 'deliveryRate', 'adSpend']) {
    const metric = truth.metrics[alias]
    if (!metric || metric.value === null) continue
    const label = language === 'ar' ? METRIC_LABELS_AR[alias] ?? METRIC_LABELS[alias] ?? alias : METRIC_LABELS[alias] ?? alias
    keyFigures.push(`${label} : ${formatTruthMetric(metric, truth.currency, state !== 'partial')}`)
  }

  const factsLine = keyFigures.slice(0, 4).join(' · ')
  const qualitativeHasFigures = /\d/.test(qualitative)
  const parts: string[] = []

  if (factsLine && !qualitativeHasFigures) parts.push(`${scope} : ${factsLine}.`)
  if (qualitative) parts.push(qualitative)
  if (state === 'partial') {
    parts.push(t.partial)
  }
  if (truth.metrics.contributionMargin?.value != null) {
    parts.push(t.margin)
  }

  if (parts.length === 0) {
    parts.push(`${scope} : ${t.noIndicator}`)
  }

  return { text: parts.join('\n\n'), rejectedAmounts: clean.rejectedAmounts }
}

function buildTruthMetricsSummary(truth: ServerTruth): Array<{ label: string; value: string | number }> {
  const summary: Array<{ label: string; value: string | number }> = []

  for (const alias of ['totalOrders', 'deliveredOrders', 'revenue', 'adSpend', 'contributionMargin', 'deliveryRate']) {
    const metric = truth.metrics[alias]
    if (!metric || metric.value === null) continue
    summary.push({ label: METRIC_LABELS[alias] ?? alias, value: formatTruthMetric(metric, truth.currency, false) })
  }

  return summary
}

function getToolLabel(toolName: AgentToolName) {
  const labels: Record<AgentToolName, string> = {
    getDashboardKPIs: 'Analyse des KPI',
    getTopProducts: 'Analyse des produits',
    getAdsSpend: 'Analyse des publicités',
    getProfitSummary: 'Calcul du profit',
    getRecentOrders: 'Lecture des commandes récentes',
    getStockSummary: 'Analyse du stock',
    getSupplierSummary: 'Analyse fournisseurs',
    getOrdersByStatus: 'Analyse statuts commandes',
    getExpensesByCategory: 'Analyse des dépenses',
    getDailyRevenueTrend: 'Tendance du revenu quotidien',
    getCityPerformance: 'Analyse performance villes',
    getConfirmationPerformance: 'Analyse agents confirmation',
    getDeliveryPerformance: 'Analyse performance livraison',
    getProductPerformance: 'Analyse détaillée produits',
    getAdsPerformanceByCampaign: 'Analyse campagnes publicitaires',
    getStoreComparison: 'Comparaison entre stores',
    getOrderSearch: 'Recherche de commandes',
    getCustomerOrderHistory: 'Historique client',
    webSearch: 'Recherche web contextuelle',
  }

  return labels[toolName] || toolName
}

function parseProviderStructuredOutput(text: string): Partial<AssistantStructuredResponse> {
  // Compatibilité : la validation stricte vit dans `response.ts`.
  const parsed = parseAssistantLlmOutput(text)
  return parsed.output
}

export { parseProviderStructuredOutput }

/**
 * Outils désactivés côté serveur. La recherche web externe n'est pas activée en
 * V1 : elle transmettrait le message utilisateur (donc des données métier) à un
 * tiers non contractualisé, sans contrôle de confidentialité.
 */
const DISABLED_AGENT_TOOLS: ReadonlySet<AgentToolName> = new Set<AgentToolName>(['webSearch'])

function filterAllowedTools<T extends { toolName: AgentToolName }>(planned: T[]): T[] {
  return planned.filter((step) => !DISABLED_AGENT_TOOLS.has(step.toolName))
}

export async function runSecureAssistantAgent(input: RunSecureAgentInput): Promise<RunSecureAgentOutput> {
  const { supabase, scopeStoreIds, scopeContext, intent, range, userMessage, conversationHistory, providerModel } = input
  const language: 'fr' | 'ar' = input.language === 'ar' ? 'ar' : 'fr'
  const provider = getAssistantProvider()

  // Comparaison de périodes : la paire explicite du message fait foi
  // (`rangeA` = période courante, `rangeB` = référence). Elle prime sur la
  // période primaire calculée par la route, qui peut ne retenir qu'un seul mois.
  const comparisonPair = intent === 'period_comparison' ? resolveComparisonPeriods(userMessage) : null
  const effectiveRange: AnalyticsRange = comparisonPair
    ? { start: comparisonPair.current.from, end: comparisonPair.current.to }
    : range
  const comparisonBaseline: BusinessRange | undefined = comparisonPair
    ? comparisonPair.baseline
    : input.comparisonBaseline

  const storeLabel = scopeContext.scopeStoreIds.length > 1
    ? `${scopeContext.scopeStoreIds.length} stores`
    : scopeContext.displayStoreName

  const activitySteps: AgentStep[] = [
    { label: 'Vérification des accès', detail: `${storeLabel} validé(s)` },
  ]

  const plannedTools = filterAllowedTools(buildToolPlan(intent, userMessage))
  activitySteps.push({ label: 'Planification agent', detail: `${plannedTools.length} outil(s) sélectionné(s)` })
  if (comparisonPair) {
    activitySteps.push({
      label: 'Périodes comparées',
      detail: `${comparisonPair.labels.current} vs ${comparisonPair.labels.baseline}`,
    })
  }

  // Session analytique unique : une seule lecture V5 pour la période, partagée
  // par tous les outils. Une période inexploitable produit des états explicites.
  let session: Awaited<ReturnType<typeof createAssistantAnalyticsSession>> | null = null
  try {
    session = createAssistantAnalyticsSession(
      supabase,
      scopeStoreIds,
      resolveAssistantBusinessRange(effectiveRange),
    )
  } catch (error) {
    activitySteps.push({
      label: 'Période non exploitable',
      detail: error instanceof Error ? error.message : 'ANALYTICS_BAD_RANGE',
    })
  }

  const toolResults: Record<string, unknown> = {}

  for (const planned of plannedTools) {
    activitySteps.push({ label: `Plan: ${getToolLabel(planned.toolName)}`, detail: planned.reason })

    let result: Awaited<ReturnType<typeof executeAgentTool>>
    try {
      result = await executeAgentTool({
        supabase,
        storeIds: scopeStoreIds,
        storeContext: {
          storeId: scopeContext.displayStoreId,
          storeName: scopeContext.displayStoreName,
          storeCurrency: scopeContext.displayCurrency,
          userMainCurrency: scopeContext.userMainCurrency,
        },
        range: effectiveRange,
        toolName: planned.toolName,
        userMessage,
        session: session ?? undefined,
        comparisonBaseline,
      })
    } catch (error) {
      // Un outil en échec ne fait pas échouer toute l'analyse : absence explicite.
      activitySteps.push({
        label: `Échec: ${getToolLabel(planned.toolName)}`,
        detail: error instanceof Error ? error.message : 'ANALYTICS_UNKNOWN',
      })
      continue
    }

    toolResults[planned.toolName] = result
    activitySteps.push({ label: `Exécution: ${getToolLabel(planned.toolName)}`, detail: 'Terminé' })
  }

  activitySteps.push({ label: 'Génération de la réponse' })


  const systemPrompt = buildAgentSystemPrompt(
    intent,
    {
      storeId: scopeContext.displayStoreId,
      storeName: scopeContext.displayStoreName,
      storeCurrency: scopeContext.displayCurrency,
      userMainCurrency: scopeContext.userMainCurrency,
    },
    language,
  )
  const userPrompt = buildAgentUserPrompt({
    userMessage,
    range,
    selectedTools: plannedTools.map((x) => x.toolName),
    toolResults: compactForPrompt(toolResults) as Record<string, unknown>,
    storeContext: {
      storeId: scopeContext.displayStoreId,
      storeName: scopeContext.displayStoreName,
      storeCurrency: scopeContext.displayCurrency,
      userMainCurrency: scopeContext.userMainCurrency,
    },
  })

  const providerResult = await provider.chat({
    model: providerModel,
    systemPrompt,
    messages: [...conversationHistory, { role: 'user', content: userPrompt }],
    signal: input.signal,
    maxOutputTokens: input.maxOutputTokens,
  })

  // Sortie IA validée strictement : JSON invalide neutralisé, champs hors
  // schéma supprimés, anomalies conservées pour la réponse.
  const parsedOutput = parseAssistantLlmOutput(providerResult.text)
  const llmOutput = parsedOutput.output

  const toolData: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(toolResults)) {
    if (value && typeof value === 'object' && 'data' in (value as Record<string, unknown>)) {
      toolData[key] = (value as { data: unknown }).data
    } else {
      toolData[key] = value
    }
  }

  const dailyResult = toolData.getDailyRevenueTrend as
    | { kind?: string; state?: string; rows?: unknown[]; days?: unknown[] }
    | undefined
  const productSection = toolData.getTopProducts as SectionResult<Record<string, unknown>> | undefined
  const citySection = toolData.getCityPerformance as SectionResult<Record<string, unknown>> | undefined
  const confirmation = toolData.getConfirmationPerformance as
    | { confirmation?: unknown; agents?: unknown }
    | undefined
  const comparison = toolData.getStoreComparison as
    | { state?: string; notices?: string[]; issues?: string[] }
    | undefined

  const sections = [
    productSection,
    citySection,
    confirmation?.confirmation,
    confirmation?.agents,
    toolData.getStockSummary,
    toolData.getDeliveryPerformance,
    toolData.getSupplierSummary,
    toolData.getExpensesByCategory,
    toolData.getAdsPerformanceByCampaign,
    toolData.getRecentOrders,
  ]
  const sectionNotices = sections.flatMap((section) => sectionWarnings(section))
  const sectionStates = sections
    .map((section) => sectionState(section))
    .filter((state): state is AnalyticsState => Boolean(state))
  const comparisonNotices = [
    ...(comparison?.notices ?? []),
    ...(comparison?.issues ?? []),
  ].filter((notice): notice is string => typeof notice === 'string')

  const truth = buildServerTruth(toolData, scopeContext.displayCurrency)

  const rangeLabel = comparisonPair
    ? `${comparisonPair.labels.current} (comparée à ${comparisonPair.labels.baseline})`
    : formatRangeLabel(effectiveRange, language)

  const explanation = llmOutput.message_text ?? parsedOutput.rawText

  // Registre des faits : valeurs publiées, avec boutique, période, devise et
  // unité. Comparaisons et points journaliers sont exclus (multi-périodes).
  const facts = collectVerifiedFacts(toolData, {
    storeIds: scopeStoreIds,
    currency: scopeContext.displayCurrency,
    range: session?.range ?? null,
  })

  const { text: messageText, rejectedAmounts } = buildTruthMessageText({
    rangeLabel,
    truth,
    explanation,
    facts,
    language,
    fallbackNotice: comparisonNotices[0] ?? null,
  })

  // Un chiffre non corroboré est retiré silencieusement : la réponse reste
  // fiable (faits vérifiés + texte qualitatif). Ce n'est pas une erreur globale ;
  // le compteur reste tracé dans `agent_run` pour l'exploitation.
  const warnings = dedupeMessages([
    ...truth.warnings,
    ...sectionNotices,
    ...comparisonNotices,
    ...(llmOutput.warnings ?? []),
    ...parsedOutput.issues,
    ...(sectionStates.includes('unavailable') ? ['Une section demandée n’est pas disponible : elle n’est pas chiffrée.'] : []),
  ])

  const summary = buildTruthMetricsSummary(truth)
  const figuresAvailable = Object.values(truth.metrics).some((metric) => metric.value !== null)
  const comparisonChartAvailable =
    Boolean(comparisonPair) &&
    (toolData.getStoreComparison as { kind?: string } | undefined)?.kind === 'periods'

  const fallbackStructured = buildStructuredResponseFromContext(intent, messageText, {
    currency: scopeContext.displayCurrency,
    rangeLabel,
    envelope: toolData.getDashboardKPIs ?? null,
    daily: dailyResult ?? null,
    products: productSection ?? null,
    cities: citySection ?? null,
    comparison: toolData.getStoreComparison ?? null,
    comparisonLabels: comparisonPair?.labels ?? null,
  })

  // Journalisation minimale : aucun contenu utilisateur, aucune donnée métier.
  console.info('[assistant] agent_run', {
    intent,
    storeId: scopeContext.displayStoreId,
    tools: Object.keys(toolData),
    envelopeState: truth.envelopeState,
    rejectedAmounts: rejectedAmounts.length,
  })

  const blocked =
    truth.envelopeState === 'forbidden' ||
    truth.envelopeState === 'missing' ||
    truth.envelopeState === 'unavailable'

  const structuredResponse: AssistantStructuredResponse = {
    ...fallbackStructured,
    conversation_title: llmOutput.conversation_title,
    message_text: messageText,
    suggestions: filterSuggestions(
      llmOutput.suggestions?.length ? llmOutput.suggestions : fallbackStructured.suggestions,
      language,
    ),
    warnings,
    metrics_summary: summary.length > 0 ? summary : fallbackStructured.metrics_summary ?? [],
    activity_steps: activitySteps,
  }

  // Aucun graphique sur une donnée absente, interdite ou sans valeur vérifiée.
  if (blocked || (!figuresAvailable && !comparisonChartAvailable)) {
    structuredResponse.chart = false
    structuredResponse.chart_type = undefined
    structuredResponse.chart_title = undefined
    structuredResponse.chart_description = undefined
    structuredResponse.chart_data = undefined
  }

  return {
    structuredResponse,
    providerUsage: providerResult,
  }
}
