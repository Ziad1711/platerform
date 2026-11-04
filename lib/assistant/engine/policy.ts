/**
 * Politique d'exécution du moteur analytique.
 *
 * Regroupe les trois seules décisions qui doivent rester centralisées :
 * - quelles capacités optionnelles sont activées (drapeaux serveur) ;
 * - quelles bornes s'appliquent à une analyse (budgets) ;
 * - comment ces bornes sont comptabilisées pendant l'exécution.
 *
 * Aucun module ne redéfinit un plafond local : les valeurs ci-dessous sont la
 * référence unique, et une analyse qui les dépasse échoue explicitement.
 */

export const ENGINE_V2_ENV = 'ASSISTANT_ENGINE_V2'
export const HISTORY_DIRECT_FALLBACK_ENV = 'ASSISTANT_HISTORY_DIRECT_FALLBACK'
export const DEEPENING_ENV = 'ASSISTANT_DEEPENING'
export const PLANNER_ENV = 'ASSISTANT_PLANNER'
export const DISTRIBUTED_ADMISSION_ENV = 'ASSISTANT_DISTRIBUTED_ADMISSION'

/** Valeur unique qui ouvre une capacité : aucune variante implicite. */
export const EXPLICIT_ENABLED = 'enabled'

type EnvLike = Record<string, string | undefined>

function readRaw(env: EnvLike, key: string): string {
  return String(env[key] ?? '').trim().toLowerCase()
}

/**
 * Drapeau strictement opt-in : seule la valeur exacte `enabled` l'active.
 *
 * `true`, `1`, `on`, `yes`, une faute de frappe ou une valeur absente laissent
 * la capacité FERMÉE. C'est la règle du verrou de pilote (`access.ts`) et elle
 * s'applique ici à toute activation de moteur ou d'admission.
 */
function readStrictFlag(env: EnvLike, key: string): boolean {
  return readRaw(env, key) === EXPLICIT_ENABLED
}

/**
 * Moteur V2 : **désactivé par défaut**.
 *
 * Le moteur introduit des lectures supplémentaires et une rédaction adossée aux
 * faits : son activation est une décision d'exploitation explicite, jamais une
 * conséquence de l'absence de configuration. Le moteur historique reste la voie
 * de repli et la seule active tant que `ASSISTANT_ENGINE_V2` n'est pas `enabled`.
 */
export function isEngineV2Enabled(env: EnvLike = process.env): boolean {
  return readStrictFlag(env, ENGINE_V2_ENV)
}

/**
 * Planification dynamique : `llm` (défaut) ou `deterministic`.
 *
 * Elle ne s'exécute que dans le moteur V2, lui-même opt-in. Toute autre valeur
 * retombe sur le plan déterministe : un plan non compris n'est jamais exécuté.
 */
export function isPlannerLlmEnabled(env: EnvLike = process.env): boolean {
  return readRaw(env, PLANNER_ENV) !== 'deterministic'
}

/**
 * Admission distribuée : **désactivée par défaut**.
 *
 * Elle exige la fonction `rpc_assistant_assert_user_admission`, qui n'existe pas
 * dans Production à ce jour (aucune migration dans cette mission). Tant que le
 * drapeau est fermé, seule l'admission en mémoire du processus s'applique et
 * l'absence de garantie inter-instances reste explicite.
 */
export function isDistributedAdmissionEnabled(env: EnvLike = process.env): boolean {
  return readStrictFlag(env, DISTRIBUTED_ADMISSION_ENV)
}

/**
 * Repli direct borné pour l'historique : **désactivé par défaut**.
 *
 * Son coût PostgreSQL n'a pas été démontré borné. Tant que ce n'est pas fait,
 * l'assistant publie un résultat partiel explicite plutôt que de déclencher des
 * lectures non mesurées.
 */
export function isHistoryDirectFallbackEnabled(env: EnvLike = process.env): boolean {
  return readStrictFlag(env, HISTORY_DIRECT_FALLBACK_ENV)
}

/** Approfondissement borné (lecture des ventilations) : actif sauf désactivation. */
export function isDeepeningEnabled(env: EnvLike = process.env): boolean {
  return readRaw(env, DEEPENING_ENV) !== 'disabled'
}

export const NARRATIVE_ENV = 'ASSISTANT_NARRATIVE'
/** Nouvelle interprétation temporelle : rollback sans changement du moteur. */
export function isSemanticPlannerEnabled(env: EnvLike = process.env): boolean {
  return readStrictFlag(env, 'ASSISTANT_SEMANTIC_PLANNER')
}

/**
 * Rédaction par le modèle : **activée par défaut** pour conserver la parité de
 * facturation avec le moteur historique (un appel fournisseur par réponse).
 *
 * Le texte produit ne peut jamais introduire de chiffre ni de code interne :
 * les blocs calculés restent la seule source des valeurs.
 */
export function isNarrativeEnabled(env: EnvLike = process.env): boolean {
  return readRaw(env, NARRATIVE_ENV) !== 'disabled'
}

export const AGENT_LLM_ENV = 'ASSISTANT_AGENT_LLM'

/**
 * Interprétation agentique : **désactivée par défaut**.
 *
 * Quand elle est ouverte, un seul appel fournisseur fusionne compréhension et
 * planification, puis un appel de réponse explicative peut suivre. Toute
 * anomalie retombe sur l'interprétation déterministe, qui annonce sa limite.
 */
export function isAgentLlmEnabled(env: EnvLike = process.env): boolean {
  return readStrictFlag(env, AGENT_LLM_ENV)
}

export interface EngineBudgets {
  /** Fenêtres élémentaires + agrégats. */
  maxPeriods: number
  /** Opérations logiques (lectures + dérivations). */
  maxOperations: number
  /** Dimensions détaillées par analyse. */
  maxDimensions: number
  /** Lectures PostgreSQL distinctes. */
  maxWindowReads: number
  /** Lectures simultanées : protège le pool de connexions. */
  maxConcurrentReads: number
  /** Durée totale avant annulation. */
  maxWallClockMs: number
  /** Passe d'approfondissement. */
  maxDeepeningSteps: number
  /** Lignes conservées par dimension. */
  maxRowsPerDimension: number
  /** Appels fournisseur (interprétation, approfondissement, réponse). */
  maxProviderCalls: number
  /** Tokens fournisseur cumulés sur le tour. */
  maxTotalTokens: number
  /** Coût fournisseur estimé cumulé, en USD. */
  maxEstimatedCostUsd: number
}

export const DEFAULT_BUDGETS: EngineBudgets = {
  maxPeriods: 6,
  maxOperations: 24,
  maxDimensions: 3,
  maxWindowReads: 8,
  maxConcurrentReads: 3,
  maxWallClockMs: 20_000,
  maxDeepeningSteps: 2,
  maxRowsPerDimension: 20,
  // Un tour agentique = interprétation + réponse, approfondissement compris.
  maxProviderCalls: 4,
  maxTotalTokens: 12_000,
  maxEstimatedCostUsd: 0.05,
}

export type BudgetCode =
  | 'BUDGET_PERIODS'
  | 'BUDGET_OPERATIONS'
  | 'BUDGET_DIMENSIONS'
  | 'BUDGET_READS'
  | 'BUDGET_TIME'
  | 'BUDGET_DEEPENING'
  | 'BUDGET_AI_CALLS'
  | 'BUDGET_AI_TOKENS'
  | 'BUDGET_AI_COST'

export class EngineBudgetError extends Error {
  readonly code: BudgetCode

  constructor(code: BudgetCode) {
    super(code)
    this.name = 'EngineBudgetError'
    this.code = code
  }
}

export interface BudgetSnapshot {
  periods: number
  operations: number
  dimensions: number
  reads: number
  deepeningSteps: number
  providerCalls: number
  tokens: number
  costUsd: number
  elapsedMs: number
}

export interface BudgetTracker {
  budgets: EngineBudgets
  consumePeriod(count?: number): void
  consumeOperation(count?: number): void
  consumeDimension(count?: number): void
  consumeRead(count?: number): void
  consumeDeepening(count?: number): void
  /** Comptabilise un appel fournisseur avant son envoi. */
  consumeProviderCall(count?: number): void
  /** Comptabilise l'usage réellement mesuré (tokens et coût estimé). */
  consumeUsage(usage: { tokens?: number | null; costUsd?: number | null }): void
  /** Lève `BUDGET_TIME` si la durée totale est dépassée. */
  assertTime(): void
  snapshot(): BudgetSnapshot
  /** Vrai si le temps restant permet une passe supplémentaire. */
  canContinue(): boolean
}

export function createBudgetTracker(
  budgets: EngineBudgets = DEFAULT_BUDGETS,
  now: () => number = Date.now,
): BudgetTracker {
  const startedAt = now()
  const counters = { periods: 0, operations: 0, dimensions: 0, reads: 0, deepeningSteps: 0, providerCalls: 0, tokens: 0, costUsd: 0 }

  const guard = (value: number, limit: number, code: BudgetCode) => {
    if (value > limit) throw new EngineBudgetError(code)
  }

  return {
    budgets,
    consumePeriod(count = 1) {
      counters.periods += count
      guard(counters.periods, budgets.maxPeriods, 'BUDGET_PERIODS')
    },
    consumeOperation(count = 1) {
      counters.operations += count
      guard(counters.operations, budgets.maxOperations, 'BUDGET_OPERATIONS')
    },
    consumeDimension(count = 1) {
      counters.dimensions += count
      guard(counters.dimensions, budgets.maxDimensions, 'BUDGET_DIMENSIONS')
    },
    consumeRead(count = 1) {
      counters.reads += count
      guard(counters.reads, budgets.maxWindowReads, 'BUDGET_READS')
    },
    consumeDeepening(count = 1) {
      counters.deepeningSteps += count
      guard(counters.deepeningSteps, budgets.maxDeepeningSteps, 'BUDGET_DEEPENING')
    },
    consumeProviderCall(count = 1) {
      counters.providerCalls += count
      guard(counters.providerCalls, budgets.maxProviderCalls, 'BUDGET_AI_CALLS')
    },
    consumeUsage(usage) {
      // Un usage inconnu ne devient jamais un zéro : il n'est simplement pas
      // compté ici, la facturation le classe déjà `usage_unknown`.
      counters.tokens += Math.max(0, Math.trunc(Number(usage.tokens) || 0))
      counters.costUsd = Number((counters.costUsd + Math.max(0, Number(usage.costUsd) || 0)).toFixed(6))
      guard(counters.tokens, budgets.maxTotalTokens, 'BUDGET_AI_TOKENS')
      if (counters.costUsd > budgets.maxEstimatedCostUsd) throw new EngineBudgetError('BUDGET_AI_COST')
    },
    assertTime() {
      if (now() - startedAt > budgets.maxWallClockMs) throw new EngineBudgetError('BUDGET_TIME')
    },
    snapshot() {
      return { ...counters, elapsedMs: now() - startedAt }
    },
    canContinue() {
      return now() - startedAt < budgets.maxWallClockMs
    },
  }
}
