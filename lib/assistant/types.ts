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
  | 'chart_request'
  | 'performance_request'
  | 'generic_business_chat'

export type AnalyticsRange = 'yesterday' | '7d' | '30d' | 'month' | 'last_month'

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
  conversation_title?: string
  suggestions?: string[]
  activity_steps?: Array<{ label: string; detail?: string }>
  warnings?: string[]
  chart?: boolean
  chart_type?: AssistantChartType
  chart_title?: string
  chart_description?: string
  chart_data?: Array<Record<string, string | number>>
  metrics_summary?: Array<{ label: string; value: string | number }>
}

export interface ChatMessageMetadata {
  structured_response?: AssistantStructuredResponse
}
