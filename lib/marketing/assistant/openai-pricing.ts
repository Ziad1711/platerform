/**
 * Tarification publique isolée du moteur ERP.
 * Un modèle inconnu retombe sur une estimation volontairement haute :
 * le budget ne doit jamais être sous-estimé silencieusement.
 */
const MODEL_PRICING: Array<{ prefix: string; inputPerMillion: number; outputPerMillion: number }> = [
  { prefix: 'gpt-5.4-mini', inputPerMillion: 0.75, outputPerMillion: 4.5 },
  { prefix: 'gpt-5.4-nano', inputPerMillion: 0.2, outputPerMillion: 1.25 },
  { prefix: 'gpt-5.4', inputPerMillion: 2.5, outputPerMillion: 15 },
  { prefix: 'gpt-4.1-mini', inputPerMillion: 0.4, outputPerMillion: 1.6 },
  { prefix: 'gpt-4.1', inputPerMillion: 2, outputPerMillion: 8 },
  { prefix: 'gpt-4o-mini', inputPerMillion: 0.15, outputPerMillion: 0.6 },
  { prefix: 'gpt-4o', inputPerMillion: 2.5, outputPerMillion: 10 },
]

const FALLBACK_PRICING = { inputPerMillion: 2.5, outputPerMillion: 15 }

export function isReasoningModel(model: string) {
  const normalized = model.toLowerCase()
  return normalized.startsWith('gpt-5') || /^o\d/.test(normalized)
}

/** Plafond réellement envoyé : les modèles à raisonnement consomment des tokens internes. */
export function effectiveMaxOutputTokens(model: string, requested: number) {
  return isReasoningModel(model) ? Math.max(requested, 1024) : requested
}

export function publicModelPricing(model: string) {
  const normalized = model.toLowerCase()
  return MODEL_PRICING.find((entry) => normalized.startsWith(entry.prefix)) ?? FALLBACK_PRICING
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number) {
  const pricing = publicModelPricing(model)
  const cost = (inputTokens / 1_000_000) * pricing.inputPerMillion
    + (outputTokens / 1_000_000) * pricing.outputPerMillion
  return Number(cost.toFixed(6))
}

/**
 * Estimation pessimiste avant appel : 3 caractères par token (au lieu de 4)
 * et marge fixe. Elle sert uniquement à refuser un appel qui dépasserait
 * le budget déjà consommé.
 */
export function estimateMaxCostMicro(
  model: string,
  systemPrompt: string,
  messages: Array<{ content: string }>,
  maxOutputTokens: number,
) {
  const chars = systemPrompt.length + messages.reduce((sum, message) => sum + message.content.length, 0)
  const inputTokens = Math.ceil(chars / 3) + 128
  return Math.ceil(estimateCostUsd(model, inputTokens, maxOutputTokens) * 1_000_000)
}
