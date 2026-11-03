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
  /**
   * `false` quand la réponse ne contient aucune mesure d'usage exploitable.
   * Un usage inconnu ne doit jamais être lu comme « zéro token ».
   */
  usageKnown?: boolean
  /**
   * Nature de l'appel : distingue une mesure réelle, un usage illisible, une
   * réponse partielle (certains appels ont échoué) et un échec complet.
   * L'absence de ce champ signifie « non classé » (moteur historique).
   */
  usageState?: AssistantUsageState
}

/**
 * - `measured` : tous les appels ont renvoyé une mesure exploitable ;
 * - `unknown`  : la mesure est illisible, aucun zéro n'est supposé ;
 * - `partial`  : certains appels ont échoué, d'autres ont réussi ;
 * - `failed`   : tous les appels ont échoué (usage éventuellement partiel).
 */
export type AssistantUsageState = 'measured' | 'unknown' | 'partial' | 'failed'


/** Échec fournisseur porteur de l'usage réellement consommé, s'il est connu. */
export interface ProviderCallError extends Error {
  usage?: AssistantProviderOutput
}

export interface AssistantProvider {
  chat(input: AssistantProviderInput): Promise<AssistantProviderOutput>
}
