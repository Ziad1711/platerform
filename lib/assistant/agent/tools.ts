import type { AnalyticsRange, AssistantIntent } from '@/lib/assistant/types'
import type { AgentStoreContext, SupabaseServerClient } from '@/lib/assistant/agent/types'
import {
  compareAssistantPeriods,
  createAssistantAnalyticsSession,
  resolveAssistantBusinessRange,
  type AssistantAnalyticsSession,
  type AnalyticsReaderResult,
} from '@/lib/assistant/analytics-reader'
import {
  readAgentSection,
  readCitySection,
  readConfirmationSection,
} from '@/lib/assistant/analytics-sections'
import {
  readDeliverySection,
  readProductSection,
  readRecentOrdersSection,
  readStockSection,
} from '@/lib/assistant/analytics-products'

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
    getStockSummary: 'évaluer le niveau de stock (RPC agrégée en attente)',
    getSupplierSummary: 'résumer la situation fournisseurs',
    getOrdersByStatus: 'analyser la distribution des statuts',
    getExpensesByCategory: 'ventiler les dépenses',
    getDailyRevenueTrend: 'analyser la tendance du revenu quotidien',
    getCityPerformance: 'analyser la performance par ville',
    getConfirmationPerformance: 'évaluer les agents de confirmation',
    getDeliveryPerformance: 'analyser la performance livraison (RPC agrégée en attente)',
    getProductPerformance: 'classer les produits par CA lignes livrées',
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
  /** Session partagée : évite de relire les KPI V5 pour chaque outil. */
  session?: AssistantAnalyticsSession
}) {
  const { storeContext, toolName } = input
  const businessRange = resolveAssistantBusinessRange(input.range)
  const session =
    input.session ??
    createAssistantAnalyticsSession(input.supabase, input.storeIds, businessRange)

  const result = async (data: unknown, currency?: string) =>
    ({ toolName, data, meta: { storeId: storeContext.storeId, currency: currency ?? storeContext.storeCurrency } }) satisfies AgentToolResult

  if (toolName === 'getStoreComparison') {
    const comparison = await compareAssistantPeriods(session.supabase, session.storeIds, session.range)
    return result(comparison)
  }

  const kpis = await session.kpis()
  const currency = kpis.stores.length === 1 ? kpis.stores[0].currency : 'MULTI'
  const request = { supabase: session.supabase, kpis }

  switch (toolName) {
    case 'getDashboardKPIs':
      return result(kpis, currency)
    case 'getProfitSummary':
      return result(selectMetrics(kpis, ['revenue', 'revenueEstimated', 'purchaseCost', 'deliveryCost', 'confirmationCost', 'contributionMargin']), currency)
    case 'getAdsSpend':
      return result(selectMetrics(kpis, ['adSpend']), currency)
    case 'getOrdersByStatus':
      return result(selectMetrics(kpis, ['orders', 'delivered', 'returned', 'cancelled']), currency)
    case 'getDailyRevenueTrend':
      return result(dailyTrend(kpis), currency)
    case 'getCityPerformance':
      return result(await readCitySection(request), currency)
    case 'getConfirmationPerformance': {
      const [funnel, agents] = await Promise.all([readConfirmationSection(request), readAgentSection(request)])
      return result({ funnel, agents }, currency)
    }
    case 'getTopProducts':
      return result(await readProductSection(request, 5), currency)
    case 'getProductPerformance':
      return result(await readProductSection(request, 10), currency)
    case 'getRecentOrders':
      return result(await readRecentOrdersSection(request, 8), currency)
    case 'getDeliveryPerformance':
      return result(readDeliverySection(request), currency)
    case 'getStockSummary':
      return result(readStockSection(request), currency)
    // Indicateurs sans agrégat autorisé : l'absence est explicite, jamais un zéro.
    case 'getSupplierSummary':
    case 'getExpensesByCategory':
    case 'getAdsPerformanceByCampaign':
    case 'getOrderSearch':
    case 'getCustomerOrderHistory':
    case 'webSearch':
      return result({
        meta: { section: toolName, state: 'unavailable' as const, source: 'none' },
        rows: [],
        totals: {},
        notices: ['Aucune agrégation bornée et autorisée pour cet indicateur dans ce lot.'],
      })
    default:
      return result({
        meta: { section: String(toolName), state: 'unavailable' as const, source: 'none' },
        rows: [],
        totals: {},
        notices: ['Outil inconnu : aucune lecture effectuée.'],
      })
  }
}

/** Sous-ensemble explicite de métriques : aucun chiffre recalculé. */
function selectMetrics(kpis: AnalyticsReaderResult, names: string[]) {
  return {
    ...kpis,
    stores: kpis.stores.map((store) => ({
      ...store,
      metrics: Object.fromEntries(Object.entries(store.metrics).filter(([name]) => names.includes(name))),
    })),
    selectedMetrics: names,
  }
}

/** Tendance quotidienne publiée par le lecteur V5, sans interpolation. */
function dailyTrend(kpis: AnalyticsReaderResult) {
  const days = kpis.stores.flatMap((store) =>
    store.days.map((day) => ({ ...day, storeId: store.storeId, currency: store.currency })),
  )
  return {
    meta: {
      section: 'daily_trend',
      state: kpis.state,
      range: kpis.range,
      timeZone: kpis.stores[0]?.timeZone ?? 'Africa/Casablanca',
      currencies: Array.from(new Set(kpis.stores.map((store) => store.currency))),
    },
    rows: days,
    notices: ['Les journées absentes ne sont pas interpolées et ne valent pas zéro.'],
  }
}
