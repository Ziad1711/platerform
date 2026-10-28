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

export interface AgentScopeContext {
  /** Stores réellement analysés par les tools */
  scopeStoreIds: string[]
  /** Store principal pour l'affichage (UI, devise, titre) */
  displayStoreId: string
  /** Nom du store principal */
  displayStoreName: string
  /** Devise d'affichage */
  displayCurrency: string
  /** Devise préférée de l'utilisateur */
  userMainCurrency: string
}

export interface RunSecureAgentInput {
  supabase: SupabaseServerClient
  /** Stores réellement passés aux tools (scope multi-store) */
  scopeStoreIds: string[]
  /** Contexte du store principal pour l'affichage */
  scopeContext: AgentScopeContext
  intent: AssistantIntent
  range: AnalyticsRange
  userMessage: string
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
  providerModel: string
  /** Annulation transmise jusqu'au fournisseur IA. */
  signal?: AbortSignal
  /** Plafond de tokens de sortie appliqué par le fournisseur. */
  maxOutputTokens?: number
  /**
   * Période de référence explicite (bornes métier). Sa présence déclenche une
   * comparaison temporelle ; son absence laisse la comparaison entre boutiques.
   */
  comparisonBaseline?: { from: string; to: string }
}

export interface RunSecureAgentOutput {
  structuredResponse: AssistantStructuredResponse
  providerUsage: AssistantProviderOutput
}
