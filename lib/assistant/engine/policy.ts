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

type EnvLike = Record<string, string | undefined>

function readFlag(env: EnvLike, key: string, fallback: boolean): boolean {
  const raw = String(env[key] ?? '').trim().toLowerCase()
  if (raw === 'enabled' || raw === 'true' || raw === '1') return true
  if (raw === 'disabled' || raw === 'false' || raw === '0') return false
  return fallback
}

/**
 * Moteur V2 : activé par défaut, désactivable sans redéploiement de logique.
 *
 * Justification : il réutilise strictement les mêmes lecteurs sécurisés et
 * n'ajoute aucun accès SQL. Il n'élargit donc pas la surface de sécurité, ce qui
 * autorise l'activation par défaut, avec retour immédiat possible.
 */
export function isEngineV2Enabled(env: EnvLike = process.env): boolean {
  return readFlag(env, ENGINE_V2_ENV, true)
}

/**
 * Repli direct borné pour l'historique : **désactivé par défaut**.
 *
 * Son coût PostgreSQL n'a pas été démontré borné. Tant que ce n'est pas fait,
 * l'assistant publie un résultat partiel explicite plutôt que de déclencher des
 * lectures non mesurées.
 */
export function isHistoryDirectFallbackEnabled(env: EnvLike = process.env): boolean {
  return readFlag(env, HISTORY_DIRECT_FALLBACK_ENV, false)
}

/** Approfondissement borné (deuxième passe) : activé, mais plafonné. */
export function isDeepeningEnabled(env: EnvLike = process.env): boolean {
  return readFlag(env, DEEPENING_ENV, true)
}

export const NARRATIVE_ENV = 'ASSISTANT_NARRATIVE'

/**
 * Rédaction par le modèle : **activée par défaut** pour conserver la parité de
 * facturation avec le moteur historique (un appel fournisseur par réponse).
 *
 * Le texte produit ne peut jamais introduire de chiffre ni de code interne :
 * les blocs calculés restent la seule source des valeurs.
 */
export function isNarrativeEnabled(env: EnvLike = process.env): boolean {
  return readFlag(env, NARRATIVE_ENV, true)
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
}

export type BudgetCode =
  | 'BUDGET_PERIODS'
  | 'BUDGET_OPERATIONS'
  | 'BUDGET_DIMENSIONS'
  | 'BUDGET_READS'
  | 'BUDGET_TIME'
  | 'BUDGET_DEEPENING'

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
  elapsedMs: number
}

export interface BudgetTracker {
  budgets: EngineBudgets
  consumePeriod(count?: number): void
  consumeOperation(count?: number): void
  consumeDimension(count?: number): void
  consumeRead(count?: number): void
  consumeDeepening(count?: number): void
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
  const counters = { periods: 0, operations: 0, dimensions: 0, reads: 0, deepeningSteps: 0 }

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
