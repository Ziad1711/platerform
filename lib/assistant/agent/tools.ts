import type { AnalyticsRange, AssistantIntent } from '@/lib/assistant/types'
import type { AgentStoreContext, SupabaseServerClient } from '@/lib/assistant/agent/types'
import { compareAssistantKpis, readAssistantKpis, resolveAssistantBusinessRange, type AnalyticsReaderResult } from '@/lib/assistant/analytics-reader'

export type AgentToolName =
  | 'getDashboardKPIs'
  | 'getTopProducts'
  | 'getAdsSpend'
  | 'getProfitSummary'
  | 'getRecentOrders'
  | 'getStockSummary'
  | 'getSupplierSummary'
  | 'getOrdersByStatus'
  | 'getExpensesByCategory'
  | 'getDailyRevenueTrend'
  | 'getCityPerformance'
  | 'getConfirmationPerformance'
  | 'getDeliveryPerformance'
  | 'getProductPerformance'
  | 'getAdsPerformanceByCampaign'
  | 'getStoreComparison'
  | 'getOrderSearch'
  | 'getCustomerOrderHistory'
  | 'webSearch'

export interface PlannedToolStep {
  toolName: AgentToolName
  reason: string
}

export interface AgentToolResult {
  toolName: AgentToolName
  data: unknown
  meta?: {
    storeId: string
    currency: string
  }
}

export function selectToolsForIntent(intent: AssistantIntent, userMessage: string): AgentToolName[] {
  const toolsByIntent: Record<AssistantIntent, AgentToolName[]> = {
    greeting: [],
    small_talk: [],
    dashboard_summary: ['getDashboardKPIs', 'getProfitSummary', 'getAdsSpend'],
    top_products: ['getTopProducts', 'getProfitSummary'],
    ads_analysis: ['getAdsSpend', 'getAdsPerformanceByCampaign', 'getDashboardKPIs'],
    profit_analysis: ['getProfitSummary', 'getTopProducts'],
    stock_analysis: ['getStockSummary'],
    supplier_summary: ['getSupplierSummary'],
    recent_orders: ['getRecentOrders', 'getOrdersByStatus'],
    comparison_request: ['getStoreComparison'],
    period_comparison: ['getStoreComparison'],
    chart_request: ['getDashboardKPIs', 'getTopProducts', 'getExpensesByCategory', 'getDailyRevenueTrend'],
    performance_request: ['getDashboardKPIs', 'getOrdersByStatus', 'getProfitSummary', 'getCityPerformance'],
    generic_business_chat: ['getDashboardKPIs', 'getProfitSummary', 'getTopProducts', 'getAdsSpend', 'getRecentOrders'],
  }

  const selected = [...(toolsByIntent[intent] || [])]
  const text = userMessage.toLowerCase()

  // Détection de dimension spécifique dans le message
  if (text.includes('ville') || text.includes('casa') || text.includes('rabat') || text.includes('marrakech') || text.includes('fès') || text.includes('tanger')) {
    if (!selected.includes('getCityPerformance')) selected.push('getCityPerformance')
  }
  if (text.includes('agent') || text.includes('confirmation') || text.includes('confirme')) {
    if (!selected.includes('getConfirmationPerformance')) selected.push('getConfirmationPerformance')
  }
  if (text.includes('livraison') || text.includes('delivery') || text.includes('transport')) {
    if (!selected.includes('getDeliveryPerformance')) selected.push('getDeliveryPerformance')
  }
  if (text.includes('campagne') || text.includes('campaign') || text.includes('roas') || text.includes('cpc') || text.includes('cpm')) {
    if (!selected.includes('getAdsPerformanceByCampaign')) selected.push('getAdsPerformanceByCampaign')
  }
  if (text.includes('compar') || text.includes(' vs ') || text.includes('versus')) {
    return ['getStoreComparison']
  }
  if (text.includes('client') || text.includes('historique') || text.includes('commande de')) {
    if (!selected.includes('getCustomerOrderHistory')) selected.push('getCustomerOrderHistory')
  }
  if (text.includes('recherche') || text.includes('trouve') || text.includes('cherche')) {
    if (!selected.includes('getOrderSearch')) selected.push('getOrderSearch')
  }
  return Array.from(new Set(selected.filter(name => name !== 'webSearch'))).slice(0, 6)
}

export function buildToolPlan(intent: AssistantIntent, userMessage: string): PlannedToolStep[] {
  const selected = selectToolsForIntent(intent, userMessage)

  const reasons: Record<AgentToolName, string> = {
    getDashboardKPIs: 'extraire les KPI principaux',
    getTopProducts: 'identifier les produits leaders',
    getAdsSpend: 'mesurer les dépenses publicitaires',
    getProfitSummary: 'calculer rentabilité et marge',
    getRecentOrders: 'inspecter les dernières commandes',
    getStockSummary: 'évaluer le niveau de stock',
    getSupplierSummary: 'résumer la situation fournisseurs',
    getOrdersByStatus: 'analyser la distribution des statuts',
    getExpensesByCategory: 'ventiler les dépenses',
    getDailyRevenueTrend: 'analyser la tendance du revenu quotidien',
    getCityPerformance: 'analyser la performance par ville',
    getConfirmationPerformance: 'évaluer les agents de confirmation',
    getDeliveryPerformance: 'analyser la performance livraison',
    getProductPerformance: 'analyser la performance détaillée des produits',
    getAdsPerformanceByCampaign: 'analyser les campagnes publicitaires',
    getStoreComparison: 'comparer les performances entre stores',
    getOrderSearch: 'rechercher des commandes spécifiques',
    getCustomerOrderHistory: 'consulter l’historique client',
    webSearch: 'enrichir avec contexte externe',
  }

  return selected.map((toolName) => ({
    toolName,
    reason: reasons[toolName] || 'analyse complémentaire',
  }))
}

export async function executeAgentTool(input: {
  supabase: SupabaseServerClient
  storeIds: string[]
  storeContext: AgentStoreContext
  range: AnalyticsRange
  toolName: AgentToolName
  userMessage: string
}) {
  const { supabase, storeIds, storeContext, range, toolName } = input

  // Les outils historiques lisent des listes plafonnées par PostgREST et exposent des coûts
  // hors du contrat financier. Ils sont bloqués jusqu'à disponibilité de RPC agrégées dédiées.
  const safeTools: AgentToolName[] = ['getDashboardKPIs', 'getAdsSpend', 'getProfitSummary', 'getOrdersByStatus', 'getDailyRevenueTrend', 'getDeliveryPerformance', 'getStoreComparison']
  if (!safeTools.includes(toolName)) {
    return { toolName, data: { state: 'unavailable', reason: 'Agrégation bornée et autorisée non disponible pour cet indicateur.' } } satisfies AgentToolResult
  }
  const businessRange = resolveAssistantBusinessRange(range)
  if (toolName === 'getStoreComparison') {
    return { toolName, data: await compareAssistantKpis(supabase, storeIds, businessRange) } satisfies AgentToolResult
  }
  const reader = await readAssistantKpis(supabase, storeIds, businessRange)
  const metrics = (names: string[]): AnalyticsReaderResult & { selectedMetrics: string[] } => ({ ...reader, selectedMetrics: names })
  const data = toolName === 'getAdsSpend' ? metrics(['adSpend'])
    : toolName === 'getProfitSummary' ? metrics(['revenue', 'purchaseCost', 'deliveryCost', 'confirmationCost', 'contributionMargin'])
    : toolName === 'getDeliveryPerformance' ? metrics(['orders', 'delivered', 'deliveryRate', 'returned', 'cancelled'])
    : toolName === 'getOrdersByStatus' ? metrics(['orders', 'delivered', 'returned', 'cancelled'])
    : toolName === 'getDailyRevenueTrend' ? metrics(['revenue'])
    : reader
  return { toolName, data, meta: { storeId: storeContext.storeId, currency: reader.stores.length === 1 ? reader.stores[0].currency : 'MULTI' } } satisfies AgentToolResult

}
