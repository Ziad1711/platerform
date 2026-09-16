import {
  getAdsSpend,
  getAdsPerformanceByCampaign,
  getCityPerformance,
  getConfirmationPerformance,
  getCustomerOrderHistory,
  getDashboardKPIs,
  getDailyRevenueTrend,
  getDeliveryPerformance,
  getExpensesByCategory,
  getOrderSearch,
  getOrdersByStatus,
  getProductPerformance,
  getProfitSummary,
  getRecentOrders,
  getStockSummary,
  getStoreComparison,
  getSupplierSummary,
  getTopProducts,
} from '@/lib/assistant/analytics'
import type { AnalyticsRange, AssistantIntent } from '@/lib/assistant/types'
import type { AgentStoreContext, SupabaseServerClient } from '@/lib/assistant/agent/types'

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
    comparison_request: ['getDashboardKPIs', 'getProfitSummary', 'getAdsSpend', 'getStoreComparison'],
    period_comparison: ['getDashboardKPIs', 'getProfitSummary', 'getAdsSpend', 'getTopProducts', 'getDailyRevenueTrend'],
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
  if (text.includes('compar') || text.includes('vs') || text.includes('versus')) {
    if (!selected.includes('getStoreComparison')) selected.push('getStoreComparison')
  }
  if (text.includes('client') || text.includes('historique') || text.includes('commande de')) {
    if (!selected.includes('getCustomerOrderHistory')) selected.push('getCustomerOrderHistory')
  }
  if (text.includes('recherche') || text.includes('trouve') || text.includes('cherche')) {
    if (!selected.includes('getOrderSearch')) selected.push('getOrderSearch')
  }
  if (
    text.includes('marché') ||
    text.includes('concurrence') ||
    text.includes('benchmark') ||
    text.includes('tendance externe')
  ) {
    selected.push('webSearch')
  }

  return Array.from(new Set(selected))
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

async function runWebSearch(query: string) {
  const response = await fetch(
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
  )

  if (!response.ok) {
    return { abstract: '', related: [], source: 'duckduckgo', failed: true }
  }

  const payload = await response.json()
  return {
    source: 'duckduckgo',
    abstract: String(payload?.AbstractText || '').slice(0, 600),
    heading: String(payload?.Heading || ''),
    related: Array.isArray(payload?.RelatedTopics)
      ? payload.RelatedTopics.slice(0, 5).map((item: any) => ({
          text: String(item?.Text || '').slice(0, 180),
          url: String(item?.FirstURL || ''),
        }))
      : [],
  }
}

export async function executeAgentTool(input: {
  supabase: SupabaseServerClient
  storeIds: string[]
  storeContext: AgentStoreContext
  range: AnalyticsRange
  toolName: AgentToolName
  userMessage: string
}) {
  const { supabase, storeIds, storeContext, range, toolName, userMessage } = input

  const withStoreMeta = (data: unknown): AgentToolResult => ({
    toolName,
    data,
    meta: {
      storeId: storeContext.storeId,
      currency: storeContext.storeCurrency,
    },
  })

  if (toolName === 'getDashboardKPIs') return withStoreMeta(await getDashboardKPIs(supabase, storeIds, range))
  if (toolName === 'getTopProducts') return withStoreMeta(await getTopProducts(supabase, storeIds, range))
  if (toolName === 'getAdsSpend') return withStoreMeta(await getAdsSpend(supabase, storeIds, range))
  if (toolName === 'getProfitSummary') return withStoreMeta(await getProfitSummary(supabase, storeIds, range))
  if (toolName === 'getRecentOrders') return withStoreMeta(await getRecentOrders(supabase, storeIds, range))
  if (toolName === 'getStockSummary') return withStoreMeta(await getStockSummary(supabase, storeIds))
  if (toolName === 'getSupplierSummary') return withStoreMeta(await getSupplierSummary(supabase, storeIds))
  if (toolName === 'getOrdersByStatus') return withStoreMeta(await getOrdersByStatus(supabase, storeIds, range))
  if (toolName === 'getExpensesByCategory') return withStoreMeta(await getExpensesByCategory(supabase, storeIds, range))
  if (toolName === 'getDailyRevenueTrend') return withStoreMeta(await getDailyRevenueTrend(supabase, storeIds, range))
  if (toolName === 'getCityPerformance') return withStoreMeta(await getCityPerformance(supabase, storeIds, range))
  if (toolName === 'getConfirmationPerformance') return withStoreMeta(await getConfirmationPerformance(supabase, storeIds, range))
  if (toolName === 'getDeliveryPerformance') return withStoreMeta(await getDeliveryPerformance(supabase, storeIds, range))
  if (toolName === 'getProductPerformance') return withStoreMeta(await getProductPerformance(supabase, storeIds, range))
  if (toolName === 'getAdsPerformanceByCampaign') return withStoreMeta(await getAdsPerformanceByCampaign(supabase, storeIds, range))
  if (toolName === 'getStoreComparison') return withStoreMeta(await getStoreComparison(supabase, storeIds, range))
  if (toolName === 'getOrderSearch') return withStoreMeta(await getOrderSearch(supabase, storeIds, userMessage))
  if (toolName === 'getCustomerOrderHistory') {
    // Extraire le nom du client du message
    const nameMatch = userMessage.match(/(?:client|commande\s+de)\s+([A-Za-zÀ-ÿ\s-]+)/i)
    const customerName = nameMatch ? nameMatch[1].trim() : userMessage
    return withStoreMeta(await getCustomerOrderHistory(supabase, storeIds, customerName))
  }
  if (toolName === 'webSearch') {
    return {
      toolName,
      data: await runWebSearch(userMessage),
    }
  }

  return null
}
