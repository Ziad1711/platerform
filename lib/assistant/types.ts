export type AssistantIntent =
  | 'greeting'
  | 'small_talk'
  | 'dashboard_summary'
  | 'top_products'
  | 'ads_analysis'
  | 'profit_analysis'
  | 'stock_analysis'
  | 'supplier_summary'
  | 'recent_orders'
  | 'comparison_request'
  | 'period_comparison'
  | 'chart_request'
  | 'performance_request'
  | 'generic_business_chat'

export interface ComparisonRange {
  rangeA: AnalyticsRange
  rangeB: AnalyticsRange
  labelA: string
  labelB: string
}

export type AnalyticsRange =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'last_week'
  | '7d'
  | '30d'
  | 'month'
  | 'last_month'
  | { start: string; end: string }

export interface AssistantUsage {
  inputTokens: number
  outputTokens: number
  providerName: string
  modelName: string
  providerCostUsd: number
  creditsUsed: number
}

export interface WalletSnapshot {
  monthlyCredits: number
  creditsUsed: number
  remainingCredits: number
}

export interface ChatMessagePayload {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export type AssistantChartType = 'line' | 'bar' | 'pie' | 'area'

export interface AssistantStructuredResponse {
  message_text: string
  /**
   * Réponse structurée en blocs typés (moteur V2).
   * Absent pour les messages produits avant cette version : le client retombe
   * alors sur `message_text`, ce qui préserve l'historique.
   */
  document?: import('@/lib/assistant/blocks/types').ResponseDocument
  /** Valeurs publiées par le moteur de comparaison, jamais extraites du texte IA. */
  comparison_table?: { currentLabel: string; baselineLabel: string; rows: Array<{ label: string; current: string; baseline: string; delta: string }> }
  conversation_title?: string
  suggestions?: string[]
  activity_steps?: Array<{ label: string; detail?: string }>
  warnings?: string[]
  chart?: boolean
  chart_type?: AssistantChartType
  /** Unité choisie côté serveur ; le client ne la déduit jamais. */
  chart_unit?: 'currency' | 'count' | 'percent'
  chart_title?: string
  chart_description?: string
  /** `null` = journée sans donnée : le client ne doit pas la convertir en zéro. */
  chart_data?: Array<Record<string, string | number | null>>
  metrics_summary?: Array<{ label: string; value: string | number }>
}

export interface ChatMessageMetadata {
  structured_response?: AssistantStructuredResponse
}
