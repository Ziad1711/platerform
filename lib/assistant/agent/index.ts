import { getAssistantProvider } from '@/lib/assistant/providers'
import { buildStructuredResponseFromContext } from '@/lib/assistant/response'
import type { AnalyticsRange, AssistantStructuredResponse, ComparisonRange } from '@/lib/assistant/types'
import { buildAgentSystemPrompt, buildAgentUserPrompt, buildPeriodComparisonUserPrompt } from '@/lib/assistant/prompt'
import { buildToolPlan, executeAgentTool, type AgentToolName } from '@/lib/assistant/agent/tools'
import type { AgentStep, RunSecureAgentInput, RunSecureAgentOutput } from '@/lib/assistant/agent/types'

function formatAmount(value: number, currency: string) {
  const amount = Number(value || 0)
  return `${amount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}

function formatCount(value: number) {
  return Number(value || 0).toLocaleString('fr-FR')
}

function buildServerTruthMetrics(toolData: Record<string, any>, currency: string) {
  const kpis = toolData.getDashboardKPIs || null
  const profit = toolData.getProfitSummary || null
  const ads = toolData.getAdsSpend || null
  const topProducts = Array.isArray(toolData.getTopProducts) ? toolData.getTopProducts : []

  // `null` = donnée indisponible (outil non exécuté). Jamais `0` : un zéro
  // inventé produirait une affirmation fausse (« aucune vente »).
  return {
    kpiAvailable: Boolean(kpis),
    totalOrders: kpis ? Number(kpis.totalOrders || 0) : null,
    deliveredOrders: kpis ? Number(kpis.deliveredOrders || 0) : null,
    revenue: kpis ? Number(kpis.revenue || 0) : null,
    deliveredRate: kpis ? Number(kpis.deliveredRate || 0) : null,
    profit: profit ? Number(profit.profit || 0) : null,
    adsSpend: ads ? Number(ads.total || 0) : null,
    currency,
    topProducts,
  }
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

function buildTruthMessageText(input: {
  range: AnalyticsRange
  metrics: ReturnType<typeof buildServerTruthMetrics>
  llmText?: string
}) {
  const { range, metrics, llmText } = input
  const rangeLabel = formatRangeLabel(range)
  const explanation = String(llmText || '').trim()

  // KPI indisponible : aucune affirmation sur les ventes. Inventer « 0 » ferait
  // dire au serveur une chose que la base n'a jamais dite.
  if (!metrics.kpiAvailable) return explanation

  if (metrics.totalOrders === 0) {
    return `Sur la période ${rangeLabel}, vous n'avez réalisé aucune vente.`
  }

  const intro = `Sur la période ${rangeLabel}, vous avez réalisé ${formatAmount(metrics.revenue ?? 0, metrics.currency)} sur ${formatCount(metrics.totalOrders ?? 0)} commande(s), dont ${formatCount(metrics.deliveredOrders ?? 0)} livrée(s).`

  // On sépare clairement : faits validés serveur + interprétation LLM.
  const facts: string[] = [intro]
  if (metrics.profit !== null) {
    facts.push(`Profit estimé: ${formatAmount(metrics.profit, metrics.currency)}.`)
  }
  if (metrics.adsSpend !== null) {
    facts.push(`Dépenses publicitaires: ${formatAmount(metrics.adsSpend, metrics.currency)}.`)
  }

  const factsText = facts.join('\n\n')
  return explanation ? `${factsText}\n\n${explanation}` : factsText
}

function buildTruthMetricsSummary(metrics: ReturnType<typeof buildServerTruthMetrics>) {
  const summary: Array<{ label: string; value: string | number }> = []

  if (metrics.revenue !== null) {
    summary.push({ label: 'Chiffre d\'affaires', value: formatAmount(metrics.revenue, metrics.currency) })
  }
  if (metrics.totalOrders !== null) {
    summary.push({ label: 'Commandes', value: formatCount(metrics.totalOrders) })
  }
  if (metrics.deliveredOrders !== null) {
    summary.push({ label: 'Commandes livrées', value: formatCount(metrics.deliveredOrders) })
  }
  if (metrics.deliveredRate !== null) {
    summary.push({
      label: 'Taux de livraison',
      value: `${metrics.deliveredRate.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`,
    })
  }
  if (metrics.profit !== null) {
    summary.push({ label: 'Profit', value: formatAmount(metrics.profit, metrics.currency) })
  }
  if (metrics.adsSpend !== null) {
    summary.push({ label: 'Dépenses Ads', value: formatAmount(metrics.adsSpend, metrics.currency) })
  }

  const topProduct = metrics.topProducts[0]
  if (topProduct) {
    summary.push({
      label: 'Top produit',
      value: `${String(topProduct.productName || 'Produit')} (${formatAmount(Number(topProduct.revenue || 0), metrics.currency)})`,
    })
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

  const toolResults: Record<string, unknown> = {}

  for (const planned of plannedTools) {
    activitySteps.push({ label: `Plan: ${getToolLabel(planned.toolName)}`, detail: planned.reason })
    const result = await executeAgentTool({
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
    })

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
  })

  const parsed = parseProviderStructuredOutput(providerResult.text)

  const toolData: Record<string, any> = {}
  for (const [key, value] of Object.entries(toolResults)) {
    if (value && typeof value === 'object' && 'data' in (value as any)) {
      toolData[key] = (value as any).data
    } else {
      toolData[key] = value
    }
  }

  const fallbackStructured = buildStructuredResponseFromContext(intent, parsed.message_text || providerResult.text, {
    currency: scopeContext.displayCurrency,
    data: {
      ...toolData,
      kpis: toolData.getDashboardKPIs,
      topProducts: toolData.getTopProducts,
      ads: toolData.getAdsSpend,
      profit: toolData.getProfitSummary,
      recentOrders: toolData.getRecentOrders,
      stock: toolData.getStockSummary,
      suppliers: toolData.getSupplierSummary,
      ordersStatus: toolData.getOrdersByStatus,
      expensesByCategory: toolData.getExpensesByCategory,
    },
  })

  const serverTruthMetrics = buildServerTruthMetrics(toolData, scopeContext.displayCurrency)
  const forcedZeroData = serverTruthMetrics.kpiAvailable && serverTruthMetrics.totalOrders === 0
  const forcedMessage = buildTruthMessageText({
    range,
    metrics: serverTruthMetrics,
    llmText: parsed.message_text || providerResult.text,
  })
  const forcedSummary = buildTruthMetricsSummary(serverTruthMetrics)

  // Journalisation minimale : aucun contenu utilisateur, aucune donnée métier.
  console.info('[assistant] agent_run', {
    intent,
    storeId: scopeContext.displayStoreId,
    tools: Object.keys(toolData),
    kpiAvailable: serverTruthMetrics.kpiAvailable,
  })

  const structuredResponse: AssistantStructuredResponse = {
    ...fallbackStructured,
    ...parsed,
    message_text: serverTruthMetrics.kpiAvailable ? forcedMessage : fallbackStructured.message_text,
    suggestions: parsed.suggestions?.length ? parsed.suggestions : fallbackStructured.suggestions,
    warnings: parsed.warnings?.length ? parsed.warnings : fallbackStructured.warnings,
    metrics_summary: forcedSummary.length > 0 ? forcedSummary : fallbackStructured.metrics_summary,
    chart: fallbackStructured.chart,
    chart_type: fallbackStructured.chart_type,
    chart_title: fallbackStructured.chart_title,
    chart_description: fallbackStructured.chart_description,
    chart_data: fallbackStructured.chart_data,
    activity_steps: activitySteps,
  }

  if (forcedZeroData) {
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
