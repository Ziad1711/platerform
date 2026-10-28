import { getAssistantProvider } from '@/lib/assistant/providers'
import { buildStructuredResponseFromContext } from '@/lib/assistant/response'
import type { AnalyticsRange, AssistantStructuredResponse } from '@/lib/assistant/types'
import { buildAgentSystemPrompt, buildAgentUserPrompt } from '@/lib/assistant/prompt'
import { buildToolPlan, executeAgentTool, type AgentToolName } from '@/lib/assistant/agent/tools'
import {
  createAssistantAnalyticsSession,
  resolveAssistantBusinessRange,
} from '@/lib/assistant/analytics-reader'
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

  const warnings = [
    ...(envelope.issues ?? []),
    ...(envelope.limits ?? []),
    ...(envelope.state === 'partial' ? ['Couverture partielle : les valeurs sont affichées avec réserve.'] : []),
    ...(envelope.state === 'forbidden' ? ['Accès financier insuffisant sur le périmètre demandé.'] : []),
  ]

  return {
    envelopeState: envelope.state,
    currency: envelope.currency ?? null,
    metrics,
    issues: envelope.issues ?? [],
    warnings,
  }
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

function formatTruthMetric(metric: TruthMetric, currency: string | null): string {
  const value = metric.value ?? '—'
  const suffix = metric.unit === 'percent' ? ' %' : metric.unit === 'decimal' && currency ? ` ${currency}` : ''
  const reserve = metric.state === 'partial' ? ' (partiel)' : ''
  return `${value}${suffix}${reserve}`
}


function formatRangeLabel(range: AnalyticsRange): string {
  if (typeof range === 'object' && 'start' in range && 'end' in range) {
    const start = new Date(range.start).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    const end = new Date(range.end).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    return `du ${start} au ${end}`
  }
  switch (range) {
    case 'yesterday': return 'hier'
    case '7d': return 'des 7 derniers jours'
    case '30d': return 'des 30 derniers jours'
    case 'month': return 'du mois en cours'
    case 'last_month': return 'du mois dernier'
    default: return 'de la période demandée'
  }
}

function buildTruthMessageText(input: { rangeLabel: string; truth: ServerTruth; llmText?: string }): string {
  const { rangeLabel, truth, llmText } = input
  const explanation = String(llmText || '').trim()
  const state = truth.envelopeState

  if (state === 'none') return explanation
  if (state === 'forbidden') {
    return `L’accès aux données financières de ce périmètre est refusé. Aucune valeur n’est affichée pour ${rangeLabel}.`
  }
  if (state === 'missing' || state === 'unavailable') {
    return `Les données ne sont pas disponibles pour ${rangeLabel}. Aucun chiffre n’est avancé.`
  }
  if (state === 'empty') {
    return `Sur la période ${rangeLabel}, aucune commande n’a été enregistrée (zéro réel).`
  }

  const facts: string[] = []
  for (const alias of ['totalOrders', 'deliveredOrders', 'revenue', 'adSpend', 'contributionMargin']) {
    const metric = truth.metrics[alias]
    if (!metric || metric.value === null) continue
    facts.push(`${METRIC_LABELS[alias] ?? alias} : ${formatTruthMetric(metric, truth.currency)}`)
  }

  if (facts.length === 0) return explanation

  const header = state === 'partial'
    ? `Données partielles pour ${rangeLabel} (couverture incomplète) :`
    : `Faits vérifiés pour ${rangeLabel} :`
  const factsText = `${header}\n${facts.map((fact) => `- ${fact}`).join('\n')}`

  return explanation ? `${factsText}\n\n${explanation}` : factsText
}

function buildTruthMetricsSummary(truth: ServerTruth): Array<{ label: string; value: string | number }> {
  const summary: Array<{ label: string; value: string | number }> = []

  for (const alias of ['totalOrders', 'deliveredOrders', 'revenue', 'adSpend', 'contributionMargin', 'deliveryRate']) {
    const metric = truth.metrics[alias]
    if (!metric || metric.value === null) continue
    summary.push({ label: METRIC_LABELS[alias] ?? alias, value: formatTruthMetric(metric, truth.currency) })
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
  const trimmed = text.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')

  if (start === -1 || end <= start) {
    return { message_text: trimmed }
  }

  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Partial<AssistantStructuredResponse>
    return parsed
  } catch {
    return { message_text: trimmed }
  }
}

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
  const provider = getAssistantProvider()

  const storeLabel = scopeContext.scopeStoreIds.length > 1
    ? `${scopeContext.scopeStoreIds.length} stores`
    : scopeContext.displayStoreName

  const activitySteps: AgentStep[] = [
    { label: 'Vérification des accès', detail: `${storeLabel} validé(s)` },
  ]

  const plannedTools = filterAllowedTools(buildToolPlan(intent, userMessage))
  activitySteps.push({ label: 'Planification agent', detail: `${plannedTools.length} outil(s) sélectionné(s)` })

  // Session analytique unique : une seule lecture V5 pour la période, partagée
  // par tous les outils. Une période inexploitable produit des états explicites.
  let session: Awaited<ReturnType<typeof createAssistantAnalyticsSession>> | null = null
  try {
    session = createAssistantAnalyticsSession(supabase, scopeStoreIds, resolveAssistantBusinessRange(range))
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
        range,
        toolName: planned.toolName,
        userMessage,
        session: session ?? undefined,
        comparisonBaseline: input.comparisonBaseline,
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

  const systemPrompt = buildAgentSystemPrompt(intent, {
    storeId: scopeContext.displayStoreId,
    storeName: scopeContext.displayStoreName,
    storeCurrency: scopeContext.displayCurrency,
    userMainCurrency: scopeContext.userMainCurrency,
  })
  const userPrompt = buildAgentUserPrompt({
    userMessage,
    range,
    selectedTools: plannedTools.map((x) => x.toolName),
    toolResults,
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

  const parsed = parseProviderStructuredOutput(providerResult.text)

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

  // Le contexte du fallback ne contient QUE des objets V2 : aucune lecture plate.
  const fallbackStructured = buildStructuredResponseFromContext(intent, parsed.message_text || providerResult.text, {
    currency: scopeContext.displayCurrency,
    envelope: toolData.getDashboardKPIs ?? null,
    daily: dailyResult ?? null,
    products: productSection ?? null,
    cities: citySection ?? null,
    comparison: toolData.getStoreComparison ?? null,
    agents: toolData.getConfirmationPerformance ?? null,
  })

  const truth = buildServerTruth(toolData, scopeContext.displayCurrency)
  const forcedMessage = buildTruthMessageText({
    rangeLabel: formatRangeLabel(range),
    truth,
    llmText: parsed.message_text || providerResult.text,
  })
  const forcedSummary = buildTruthMetricsSummary(truth)
  const declaredWarnings = Array.isArray(parsed.warnings) ? parsed.warnings : []
  const warnings = Array.from(new Set([...declaredWarnings, ...truth.warnings]))

  // Journalisation minimale : aucun contenu utilisateur, aucune donnée métier.
  console.info('[assistant] agent_run', {
    intent,
    storeId: scopeContext.displayStoreId,
    tools: Object.keys(toolData),
    envelopeState: truth.envelopeState,
  })

  const figuresAvailable = Object.values(truth.metrics).some((metric) => metric.value !== null)

  const structuredResponse: AssistantStructuredResponse = {
    ...fallbackStructured,
    ...parsed,
    message_text: truth.envelopeState === 'none' ? fallbackStructured.message_text : forcedMessage,
    suggestions: parsed.suggestions?.length ? parsed.suggestions : fallbackStructured.suggestions,
    warnings: warnings.length ? warnings : fallbackStructured.warnings,
    metrics_summary: forcedSummary.length > 0 ? forcedSummary : fallbackStructured.metrics_summary,
    chart: fallbackStructured.chart,
    chart_type: fallbackStructured.chart_type,
    chart_title: fallbackStructured.chart_title,
    chart_description: fallbackStructured.chart_description,
    chart_data: fallbackStructured.chart_data,
    activity_steps: activitySteps,
  }

  // Aucun graphique sur une donnée absente ou interdite : un axe vide n'est pas
  // un résultat métier.
  if (
    !figuresAvailable ||
    truth.envelopeState === 'forbidden' ||
    truth.envelopeState === 'missing' ||
    truth.envelopeState === 'unavailable'
  ) {
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
