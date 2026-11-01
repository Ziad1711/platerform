import type { AnalyticsRange, AssistantIntent } from '@/lib/assistant/types'
import type { AgentStoreContext, SupabaseServerClient } from '@/lib/assistant/agent/types'
import type { BusinessRange } from '@/lib/dashboard/business-time'
import { ANALYTICS_CONTRACT_VERSION } from '@/lib/assistant/analytics-contract'
import {
  buildKpiEnvelope,
  compareAssistantPeriods,
  compareAssistantStores,
  createAssistantAnalyticsSession,
  resolveAssistantBusinessRange,
  type AnalyticsReaderResult,
  type AssistantAnalyticsSession,
} from '@/lib/assistant/analytics-reader'
import { readAgentSection, readCitySection, readConfirmationSection } from '@/lib/assistant/analytics-sections'
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
    dashboard_summary: ['getDashboardKPIs', 'getDailyRevenueTrend'],
    top_products: ['getTopProducts', 'getDashboardKPIs'],
    ads_analysis: ['getDashboardKPIs'],
    profit_analysis: ['getDashboardKPIs'],
    stock_analysis: ['getStockSummary'],
    supplier_summary: ['getSupplierSummary'],
    recent_orders: ['getRecentOrders', 'getDashboardKPIs'],
    comparison_request: ['getStoreComparison'],
    period_comparison: ['getStoreComparison'],
    chart_request: ['getDashboardKPIs', 'getDailyRevenueTrend'],
    performance_request: ['getDashboardKPIs', 'getDailyRevenueTrend'],
    generic_business_chat: ['getDashboardKPIs'],
  }

  const selected = [...(toolsByIntent[intent] || [])]
  const text = userMessage.toLowerCase()
  // Les RPC détaillées agrègent les commandes en amont du LIMIT de résultat.
  // Un bilan ouvert reste sur V5 ; la demande ciblée ajoute la dimension.

  // Détection de dimension spécifique dans le message
  if (text.includes('ville') || text.includes('casa') || text.includes('rabat') || text.includes('marrakech') || text.includes('fès') || text.includes('tanger')) {
    if (!selected.includes('getCityPerformance')) selected.push('getCityPerformance')
  }
  if (/(?:مدينة|مدن|المدن|المدينة)/.test(text) && !selected.includes('getCityPerformance')) selected.push('getCityPerformance')
  if (/(?:منتوج|منتجات|المنتجات)/.test(text) && !selected.includes('getTopProducts')) selected.push('getTopProducts')
  if ((text.includes('produit') || text.includes('article')) && !selected.includes('getTopProducts')) selected.push('getTopProducts')
  if (/(?:تأكيد|أكد|التأكيد)/.test(text) && !selected.includes('getConfirmationPerformance')) selected.push('getConfirmationPerformance')
  if (text.includes('agent') || text.includes('confirmation') || text.includes('confirme')) {
    if (!selected.includes('getConfirmationPerformance')) selected.push('getConfirmationPerformance')
  }
  if (text.includes('transport') || text.includes('transporteur')) {
    if (!selected.includes('getDeliveryPerformance')) selected.push('getDeliveryPerformance')
  }
  if (text.includes('campagne') || text.includes('campaign') || text.includes('roas') || text.includes('cpc') || text.includes('cpm')) {
    if (!selected.includes('getAdsPerformanceByCampaign')) selected.push('getAdsPerformanceByCampaign')
  }
  if (intent !== 'period_comparison' && (text.includes('compar') || text.includes(' vs ') || text.includes('versus') || text.includes('قارن'))) {
    if (!selected.includes('getStoreComparison')) selected.push('getStoreComparison')
  }
  if ((text.includes('dépense') || text.includes('depense') || text.includes('charge')) && intent !== 'ads_analysis') {
    if (!selected.includes('getExpensesByCategory')) selected.push('getExpensesByCategory')
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

export interface ExecuteAgentToolInput {
  supabase: SupabaseServerClient
  storeIds: string[]
  storeContext: AgentStoreContext
  range: AnalyticsRange
  toolName: AgentToolName
  userMessage: string
  /** Session injectable : partage la lecture V5 entre tous les outils d'une requête. */
  session?: AssistantAnalyticsSession
  /**
   * Période de référence explicite pour `getStoreComparison` :
   * fournie ⇒ comparaison **de périodes** ; absente ⇒ comparaison **de boutiques**.
   */
  comparisonBaseline?: BusinessRange
}

/**
 * Exécute un outil analytique.
 *
 * Aucun outil ne renvoie un chiffre sans état : le résultat est une enveloppe
 * versionnée (`KpiEnvelope`, `PeriodComparison`, `StoreComparison`) ou une
 * `SectionResult`. Le consommateur doit lire l'état avant toute valeur.
 */
export async function executeAgentTool(input: ExecuteAgentToolInput) {
  const { storeContext, toolName } = input

  // La résolution de période est une garde : une plage non exploitable produit
  // un résultat explicite, jamais une exception générique côté route.
  let session = input.session
  if (!session) {
    try {
      session = createAssistantAnalyticsSession(
        input.supabase,
        input.storeIds,
        resolveAssistantBusinessRange(input.range),
      )
    } catch (error) {
      return {
        toolName,
        data: invalidRangeEnvelope(error),
        meta: { storeId: storeContext.storeId, currency: storeContext.storeCurrency },
      }
    }
  }

  const result = (data: unknown, currency?: string) => ({
    toolName,
    data,
    meta: { storeId: storeContext.storeId, currency: currency ?? storeContext.storeCurrency },
  }) satisfies AgentToolResult

  if (toolName === 'getStoreComparison') {
    // Deux comparaisons strictement distinctes.
    try {
      if (input.comparisonBaseline) {
        const comparison = await compareAssistantPeriods(
          session.supabase,
          [...session.storeIds],
          session.range,
          input.comparisonBaseline,
          session,
        )
        return result(comparison)
      }
      const comparison = await compareAssistantStores(session.supabase, [...session.storeIds], session.range, session)
      return result(comparison)
    } catch (error) {
      return result(comparisonFailure(error))
    }
  }

  const kpis = await session.kpis()
  const envelope = buildKpiEnvelope(kpis)
  const request = { supabase: session.supabase, kpis }

  switch (toolName) {
    case 'getDashboardKPIs':
    case 'getProfitSummary':
    case 'getAdsSpend':
    case 'getOrdersByStatus':
      // Une seule enveloppe, toutes les métriques étiquetées : le consommateur
      // choisit les alias à afficher, sans jamais recevoir un zéro par défaut.
      return result(envelope, envelope.currency ?? 'MULTI')
    case 'getDailyRevenueTrend':
      return result(dailyTrend(kpis), envelope.currency ?? 'MULTI')
    case 'getCityPerformance':
      return result(await readCitySection(request))
    case 'getConfirmationPerformance': {
      // Le tunnel agrégé suffit à une question de confirmation générale.
      // Ne lire la RPC par agent que si cette dimension a été demandée.
      const confirmation = await readConfirmationSection(request)
      const byAgent = /(?:agent|commercial|الموظف|الوكيل)/i.test(input.userMessage)
      const agents = byAgent ? await readAgentSection(request) : undefined
      return result({ confirmation, agents })
    }
    case 'getTopProducts':
      return result(await readProductSection(request, 5))
    case 'getProductPerformance':
      return result(await readProductSection(request, 10))
    case 'getRecentOrders':
      return result(await readRecentOrdersSection(request, 8))
    case 'getDeliveryPerformance':
      return result(readDeliverySection(request))
    case 'getStockSummary':
      return result(readStockSection(request))
    case 'getSupplierSummary':
    case 'getExpensesByCategory':
    case 'getAdsPerformanceByCampaign':
    case 'getOrderSearch':
    case 'getCustomerOrderHistory':
    case 'webSearch':
      return result(unavailableSection(toolName))
    default:
      return result(unavailableSection(String(toolName)))
  }
}

/** Explication naturelle par section, sans jargon interne ni chiffre. */
const UNAVAILABLE_REASONS: Record<string, string> = {
  getSupplierSummary: 'Le solde fournisseur agrégé n’est pas encore disponible pour l’assistant.',
  getExpensesByCategory:
    'La ventilation des dépenses par catégorie n’est pas encore disponible ici. Le total des dépenses opérationnelles reste consultable dans Finance.',
  getAdsPerformanceByCampaign:
    'La performance par campagne n’est pas encore disponible : la publicité est publiée au niveau global de la période.',
  getOrderSearch: 'La recherche de commande n’est pas encore disponible dans la conversation.',
  getCustomerOrderHistory: 'L’historique client n’est pas accessible dans la conversation pour des raisons de confidentialité.',
  getDeliveryPerformance:
    'La performance par transporteur n’est pas encore disponible. Les livraisons restent visibles dans la page Livraison.',
  getStockSummary:
    'Le stock par variante n’est pas encore disponible ici. Le niveau de stock reste consultable dans la page Stock.',
  webSearch: 'La recherche externe n’est pas activée.',
}

/** Section non disponible : forme identique à `SectionResult`, aucun chiffre. */
function unavailableSection(section: string) {
  return {
    contractVersion: ANALYTICS_CONTRACT_VERSION,
    meta: { section, state: 'unavailable' as const, source: 'none', issues: [] },
    rows: [],
    totals: {},
    notices: [
      UNAVAILABLE_REASONS[section] || 'Cet indicateur n’est pas encore disponible pour l’assistant.',
    ],
  }
}

function issueMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'ANALYTICS_UNKNOWN'
}

/** Période non exploitable : état `missing`, aucune valeur, anomalie exposée. */
function invalidRangeEnvelope(error: unknown) {
  return {
    contractVersion: ANALYTICS_CONTRACT_VERSION,
    kind: 'kpis' as const,
    state: 'missing' as const,
    range: null,
    currency: null,
    metrics: {},
    stores: [],
    limits: [],
    issues: [issueMessage(error)],
  }
}

/** Échec de comparaison (période de référence invalide, lecture impossible). */
function comparisonFailure(error: unknown) {
  return {
    contractVersion: ANALYTICS_CONTRACT_VERSION,
    kind: 'unavailable' as const,
    state: 'missing' as const,
    deltas: [],
    notices: ['Comparaison non réalisée : période ou lecture invalide.'],
    issues: [issueMessage(error)],
  }
}

/** Tendance quotidienne publiée par le lecteur V5, sans interpolation. */
function dailyTrend(kpis: AnalyticsReaderResult) {
  return {
    contractVersion: kpis.contractVersion,
    kind: 'daily' as const,
    state: kpis.state,
    range: kpis.range,
    timeZone: kpis.stores[0]?.timeZone ?? null,
    days: kpis.stores.flatMap((store) =>
      store.days.map((day) => ({ ...day, storeId: store.storeId, currency: store.currency })),
    ),
    issues: kpis.issues,
    notices: ['Les journées absentes ne sont pas interpolées et ne valent pas zéro.'],
  }
}
