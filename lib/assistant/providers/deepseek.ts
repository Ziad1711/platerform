import type { AssistantProvider, AssistantProviderInput, AssistantProviderOutput } from '@/lib/assistant/providers/types'

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions'

const COST_PER_1K_INPUT = 0.00014
const COST_PER_1K_OUTPUT = 0.00028

export class DeepSeekProvider implements AssistantProvider {
  async chat(input: AssistantProviderInput): Promise<AssistantProviderOutput> {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      throw new Error('Clé DeepSeek manquante côté serveur (DEEPSEEK_API_KEY)')
    }

    const response = await fetch(DEEPSEEK_ENDPOINT, {
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
      throw new Error('DEEPSEEK_CALL_FAILED')
    }

    const payload = await response.json()
    const text = payload?.choices?.[0]?.message?.content
    if (!text || typeof text !== 'string') {
      throw new Error('DEEPSEEK_EMPTY_RESPONSE')
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
      providerName: 'deepseek',
      modelName: input.model,
      providerCostUsd,
    }
  }
}
