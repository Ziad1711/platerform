export interface AssistantProviderInput {
  model: string
  systemPrompt: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Annulation coopérative : le fournisseur doit interrompre sa requête HTTP. */
  signal?: AbortSignal
  /** Plafond de tokens de sortie appliqué côté fournisseur. */
  maxOutputTokens?: number
}

export interface AssistantProviderOutput {
  text: string
  inputTokens: number
  outputTokens: number
  providerName: string
  modelName: string
  providerCostUsd: number
}

export interface AssistantProvider {
  chat(input: AssistantProviderInput): Promise<AssistantProviderOutput>
}
