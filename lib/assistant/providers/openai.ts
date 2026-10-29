import type { AssistantProvider, AssistantProviderInput, AssistantProviderOutput } from '@/lib/assistant/providers/types'

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'

/**
 * Tarifs par million de tokens (USD), modèle → { input, output }.
 * Valeurs vérifiées dans la documentation officielle au moment de l'ajout ;
 * un modèle inconnu retombe sur une tarification explicite et sur-estimée afin
 * de ne jamais sous-facturer silencieusement.
 */
const MODEL_PRICING: Array<{ prefix: string; inputPerMillion: number; outputPerMillion: number }> = [
  { prefix: 'gpt-5.4-mini', inputPerMillion: 0.75, outputPerMillion: 4.5 },
  { prefix: 'gpt-5.4-nano', inputPerMillion: 0.2, outputPerMillion: 1.25 },
  { prefix: 'gpt-5.4', inputPerMillion: 2.5, outputPerMillion: 15 },
  { prefix: 'gpt-4.1-mini', inputPerMillion: 0.4, outputPerMillion: 1.6 },
  { prefix: 'gpt-4o-mini', inputPerMillion: 0.15, outputPerMillion: 0.6 },
  { prefix: 'gpt-4o', inputPerMillion: 2.5, outputPerMillion: 10 },
]

const FALLBACK_PRICING = { inputPerMillion: 2.5, outputPerMillion: 15 }

function pricingFor(model: string) {
  const normalized = model.toLowerCase()
  return MODEL_PRICING.find((entry) => normalized.startsWith(entry.prefix)) ?? FALLBACK_PRICING
}

/** Modèles à raisonnement : plafond via `max_completion_tokens`, pas de `temperature`. */
function isReasoningModel(model: string) {
  const normalized = model.toLowerCase()
  return normalized.startsWith('gpt-5') || /^o\d/.test(normalized)
}

export class OpenAIProvider implements AssistantProvider {
  async chat(input: AssistantProviderInput): Promise<AssistantProviderOutput> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('Clé OpenAI manquante côté serveur (OPENAI_API_KEY)')
    }

    const reasoning = isReasoningModel(input.model)
    const reasoningEffort = (process.env.ASSISTANT_REASONING_EFFORT || 'none').trim().toLowerCase()

    const body: Record<string, unknown> = {
      model: input.model,
      messages: [
        { role: 'system', content: input.systemPrompt },
        ...input.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      ],
    }

    if (reasoning) {
      // GPT-5.x : `temperature` non supporté, effort de raisonnement explicite.
      if (reasoningEffort && reasoningEffort !== 'default') body.reasoning_effort = reasoningEffort
      if (input.maxOutputTokens) body.max_completion_tokens = input.maxOutputTokens
    } else {
      body.temperature = 0.2
      if (input.maxOutputTokens) body.max_tokens = input.maxOutputTokens
    }

    const response = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: input.signal,
      body: JSON.stringify(body),
    }).catch((error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('OPENAI_ABORTED')
      throw new Error('OPENAI_CALL_FAILED')
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
    const pricing = pricingFor(input.model)

    const providerCostUsd = Number(
      (
        (inputTokens / 1_000_000) * pricing.inputPerMillion +
        (outputTokens / 1_000_000) * pricing.outputPerMillion
      ).toFixed(6)
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
