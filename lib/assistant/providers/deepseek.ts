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
      signal: input.signal,
      body: JSON.stringify({
        model: input.model,
        temperature: 0.2,
        ...(input.maxOutputTokens ? { max_tokens: input.maxOutputTokens } : {}),
        messages: [
          { role: 'system', content: input.systemPrompt },
          ...input.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        ],
      }),
    }).catch((error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('DEEPSEEK_ABORTED')
      throw new Error('DEEPSEEK_CALL_FAILED')
    })

    if (!response.ok) {
      throw new Error('DEEPSEEK_CALL_FAILED')
    }

    const payload = await response.json()
    const text = payload?.choices?.[0]?.message?.content
    // Usage lu avant toute sortie : un texte absent ne doit pas effacer les tokens.
    const hasUsage = payload?.usage !== null && typeof payload?.usage === 'object'
    const inputTokens = hasUsage ? Number(payload?.usage?.prompt_tokens) : 0
    const outputTokens = hasUsage ? Number(payload?.usage?.completion_tokens) : 0
    const usageKnown = hasUsage && Number.isFinite(inputTokens) && Number.isFinite(outputTokens)
    // Coût calculé avant toute sortie : un texte absent ne doit pas effacer la
    // dépense réelle de l'appel.
    const providerCostUsd = usageKnown
      ? Number(
          ((inputTokens / 1000) * COST_PER_1K_INPUT + (outputTokens / 1000) * COST_PER_1K_OUTPUT).toFixed(6)
        )
      : 0
    const usage = {
      text: typeof text === 'string' ? text : '',
      inputTokens: usageKnown ? inputTokens : 0,
      outputTokens: usageKnown ? outputTokens : 0,
      providerName: 'deepseek',
      modelName: input.model,
      providerCostUsd,
      usageKnown,
      usageState: usageKnown ? ('measured' as const) : ('unknown' as const),
    }

    if (!text || typeof text !== 'string') {
      const error = new Error('_EMPTY_RESPONSE') as Error & { usage?: AssistantProviderOutput }
      error.usage = { ...usage, usageState: 'failed' }
      throw error
    }

    return {
      text,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      providerName: 'deepseek',
      modelName: input.model,
      providerCostUsd,
      usageKnown,
      usageState: usage.usageState,
    }
  }
}
