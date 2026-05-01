export interface AssistantProviderInput {
  model: string
  systemPrompt: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
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
