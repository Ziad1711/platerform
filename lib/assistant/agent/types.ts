import type { AnalyticsRange, AssistantIntent, AssistantStructuredResponse } from '@/lib/assistant/types'
import { createClient } from '@/lib/supabase/server'
import type { AssistantProviderOutput } from '@/lib/assistant/providers/types'

export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export interface AgentStep {
  label: string
  detail?: string
}

export interface AgentStoreContext {
  storeId: string
  storeName: string
  storeCurrency: string
  userMainCurrency: string
}

export interface RunSecureAgentInput {
  supabase: SupabaseServerClient
  storeIds: string[]
  storeContext: AgentStoreContext
  intent: AssistantIntent
  range: AnalyticsRange
  userMessage: string
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
  providerModel: string
}

export interface RunSecureAgentOutput {
  structuredResponse: AssistantStructuredResponse
  providerUsage: AssistantProviderOutput
}
