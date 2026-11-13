import type {
  AssistantProvider,
  AssistantProviderInput,
  AssistantProviderOutput,
  ProviderCallError,
} from '@/lib/assistant/providers/types'
import { estimateCostUsd, effectiveMaxOutputTokens, isReasoningModel } from './openai-pricing'

const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses'

type ResponsesUsage = { input_tokens?: number; output_tokens?: number }

function extractText(payload: unknown) {
  const body = payload as {
    output_text?: unknown
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: unknown; refusal?: unknown }> }>
  }
  if (typeof body?.output_text === 'string' && body.output_text.trim()) return body.output_text
  const parts: string[] = []
  for (const item of body?.output ?? []) {
    if (item?.type !== 'message') continue
    for (const part of item.content ?? []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') parts.push(part.text)
      if (part?.type === 'refusal' && typeof part.refusal === 'string') parts.push(part.refusal)
    }
  }
  return parts.join('\n').trim()
}

function readUsage(payload: unknown, model: string) {
  const usage = (payload as { usage?: ResponsesUsage })?.usage
  const inputTokens = Number(usage?.input_tokens)
  const outputTokens = Number(usage?.output_tokens)
  const known = usage !== null && typeof usage === 'object'
    && Number.isFinite(inputTokens) && Number.isFinite(outputTokens)
  return {
    inputTokens: known ? inputTokens : 0,
    outputTokens: known ? outputTokens : 0,
    providerCostUsd: known ? estimateCostUsd(model, inputTokens, outputTokens) : 0,
    known,
  }
}

/**
 * Moteur conversationnel public fondé sur l’API Responses.
 *
 * - `store: false` : aucun état conversationnel conservé par le fournisseur.
 * - L’historique est fourni par le client, borné par la route.
 * - Aucun outil, aucun accès aux données ERP : le contexte commercial est
 *   entièrement contenu dans les instructions.
 * - Le moteur ERP (`lib/assistant/providers/openai.ts`) n’est pas utilisé.
 */
export class OpenAIResponsesProvider implements AssistantProvider {
  async chat(input: AssistantProviderInput): Promise<AssistantProviderOutput> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY_MISSING')

    const reasoning = isReasoningModel(input.model)
    const maxOutputTokens = input.maxOutputTokens ?? 360
    const body: Record<string, unknown> = {
      model: input.model,
      instructions: input.systemPrompt,
      input: input.messages.map((message) => ({ role: message.role, content: message.content })),
      max_output_tokens: effectiveMaxOutputTokens(input.model, maxOutputTokens),
      store: false,
    }
    if (reasoning) {
      const effort = (process.env.PUBLIC_AI_REASONING_EFFORT || 'low').trim().toLowerCase()
      if (effort && effort !== 'default') body.reasoning = { effort }
    } else {
      const configured = Number(process.env.PUBLIC_AI_TEMPERATURE ?? 0.4)
      body.temperature = Number.isFinite(configured) ? Math.min(1.2, Math.max(0, configured)) : 0.4
    }

    const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: input.signal,
      body: JSON.stringify(body),
    }).catch((error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('OPENAI_ABORTED')
      throw new Error('OPENAI_CALL_FAILED')
    })

    if (!response.ok) throw new Error(`OPENAI_HTTP_${response.status}`)

    const payload = await response.json()
    const text = extractText(payload)
    const usage = readUsage(payload, input.model)
    const output: AssistantProviderOutput = {
      text,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      providerName: 'openai-responses',
      modelName: input.model,
      providerCostUsd: usage.providerCostUsd,
      usageKnown: usage.known,
      usageState: usage.known ? 'measured' : 'unknown',
    }

    if (!text) {
      const error = new Error('OPENAI_EMPTY_RESPONSE') as ProviderCallError
      // L’usage réel reste attaché : un échec ne doit jamais effacer des tokens consommés.
      error.usage = { ...output, usageState: 'failed' }
      throw error
    }

    return output
  }
}
