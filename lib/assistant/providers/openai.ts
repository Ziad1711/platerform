import type { AssistantProvider, AssistantProviderInput, AssistantProviderOutput } from '@/lib/assistant/providers/types'

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'

const COST_PER_1K_INPUT = 0.005
const COST_PER_1K_OUTPUT = 0.015

export class OpenAIProvider implements AssistantProvider {
  async chat(input: AssistantProviderInput): Promise<AssistantProviderOutput> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('Clé OpenAI manquante côté serveur (OPENAI_API_KEY)')
    }

    const response = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: input.systemPrompt },
          ...input.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        ],
      }),
    })

    if (!response.ok) {
      throw new Error('OPENAI_CALL_FAILED')
    }

    const payload = await response.json()
    const text = payload?.choices?.[0]?.message?.content
    if (!text || typeof text !== 'string') {
      throw new Error('OPENAI_EMPTY_RESPONSE')
    }

    const inputTokens = Number(payload?.usage?.prompt_tokens || 0)
    const outputTokens = Number(payload?.usage?.completion_tokens || 0)

    const providerCostUsd = Number(
      ((inputTokens / 1000) * COST_PER_1K_INPUT + (outputTokens / 1000) * COST_PER_1K_OUTPUT).toFixed(6)
    )

    return {
      text,
      inputTokens,
      outputTokens,
      providerName: 'openai',
      modelName: input.model,
      providerCostUsd,
    }
  }
}
