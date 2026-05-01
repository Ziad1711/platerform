import type { AssistantIntent, AssistantStructuredResponse } from '@/lib/assistant/types'

const DEFAULT_SUGGESTIONS = [
  'Analyse mon business',
  'Montre-moi mes ventes',
  'Quels sont mes meilleurs produits ?',
  'Résume mes dépenses',
  'Analyse mon stock',
]

export function buildGreetingResponse(): AssistantStructuredResponse {
  return {
    message_text: 'Bonjour 👋 Comment puis-je vous aider aujourd’hui ?',
    suggestions: DEFAULT_SUGGESTIONS,
    chart: false,
  }
}

function formatAmount(value: number, currency?: string) {
  const cur = currency || 'MAD'
  return `${Number(value || 0).toFixed(2)} ${cur}`
}

export function buildSmallTalkResponse(): AssistantStructuredResponse {
  return {
    message_text: 'Avec plaisir 🙌 Dites-moi ce que vous voulez analyser sur votre store.',
    suggestions: DEFAULT_SUGGESTIONS,
    chart: false,
  }
}

export function buildStructuredResponseFromContext(
  intent: AssistantIntent,
  aiText: string,
  context: any
): AssistantStructuredResponse {
  const currency = context?.currency || 'MAD'

  const base: AssistantStructuredResponse = {
    message_text: aiText,
    suggestions: DEFAULT_SUGGESTIONS,
    warnings: [],
    chart: false,
  }

  if (intent === 'top_products' && context?.data?.topProducts?.length) {
    return {
      ...base,
      chart: true,
      chart_type: 'bar',
      chart_title: 'Top produits (revenu)',
      chart_description: 'Produits les plus performants sur la période demandée.',
      chart_data: context.data.topProducts.map((item: any) => ({
        name: item.productName,
        revenu: Number(item.revenue || 0),
        profit: Number(item.profit || 0),
      })),
      metrics_summary: [
        {
          label: 'Nombre de produits',
          value: context.data.topProducts.length,
        },
        {
          label: 'Devise',
          value: currency,
        },
      ],
    }
  }

  if ((intent === 'ads_analysis' || intent === 'chart_request') && context?.data?.ads?.byPlatform) {
    return {
      ...base,
      chart: true,
      chart_type: 'pie',
      chart_title: 'Répartition dépenses publicitaires',
      chart_description: 'Distribution par plateforme.',
      chart_data: Object.entries(context.data.ads.byPlatform).map(([platform, amount]) => ({
        name: platform,
        valeur: Number(amount || 0),
      })),
      metrics_summary: [
        { label: 'Dépense totale Ads', value: formatAmount(Number(context.data.ads.total || 0), currency) },
        { label: 'Devise', value: currency },
      ],
    }
  }

  if (
    (intent === 'dashboard_summary' || intent === 'performance_request' || intent === 'comparison_request') &&
    context?.data?.dailyRevenue?.length
  ) {
    return {
      ...base,
      chart: true,
      chart_type: 'line',
      chart_title: 'Évolution du chiffre d’affaires',
      chart_description: 'Tendance des revenus sur la période.',
      chart_data: context.data.dailyRevenue,
      metrics_summary: [
        { label: 'Commandes', value: Number(context.data.kpis?.totalOrders || 0) },
        { label: 'CA', value: formatAmount(Number(context.data.kpis?.revenue || 0), currency) },
        { label: 'Profit', value: formatAmount(Number(context.data.profit?.profit || 0), currency) },
        { label: 'Devise', value: currency },
      ],
    }
  }

  if (intent === 'stock_analysis' && context?.data?.stock?.items?.length) {
    return {
      ...base,
      chart: true,
      chart_type: 'bar',
      chart_title: 'Niveaux de stock (top faibles)',
      chart_description: 'Produits avec les niveaux de stock les plus bas.',
      chart_data: context.data.stock.items.map((item: any) => ({
        name: item.productName,
        stock: Number(item.stock || 0),
      })),
      metrics_summary: [
        { label: 'Produits suivis', value: Number(context.data.stock.totalProducts || 0) },
        { label: 'Stock faible', value: Number(context.data.stock.lowStock || 0) },
      ],
    }
  }

  return base
}
