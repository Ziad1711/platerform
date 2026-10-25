// ============================================================
// Budgets et progression du parcours de suivi livraison.
//
// Le cron disposait d'un budget fixe de 6 s par couple (store, transporteur)
// pour un budget total de 25 s : avec 10 couples connectes et un appel
// transporteur de 2 a 4 s, la limite de colis par passage tombait a 1 ou 2,
// alors que la file en comptait 11. La file ne se vidait donc pas entre deux
// passages de 10 minutes.
//
// Regles retenues :
//  - un couple ne demarre que si le budget restant couvre un appel ET sa
//    finalisation (sinon on reporte : aucun appel tronque) ;
//  - le budget d'un couple est borne par le budget total restant, jamais
//    depasse ;
//  - aucun nouveau parallelisme : le verrou SQL par transporteur reste la
//    seule voie d'execution.
// ============================================================

/** Marge de finalisation conservee en fin de lot (liberations, couverture). */
export const TARGET_FINALIZE_MARGIN_MS = 2_000

/**
 * Budget minimal pour ouvrir un lot : un appel transporteur complet
 * (timeout max 6 s) + la marge de finalisation. En dessous, l'appel serait
 * tronque : mieux vaut rendre la main au passage suivant.
 */
export const MIN_TARGET_BUDGET_MS = 8_000

/** Plafond par couple : borne le lot sans monopoliser tout le cron. */
export const MAX_TARGET_BUDGET_MS = 12_000

/** Marge de securite sous la duree maximale de la fonction. */
export const SWEEP_SAFETY_MARGIN_MS = 1_000

/**
 * Budget a accorder au prochain couple (store, transporteur).
 * Retourne 0 quand il vaut mieux rendre la main au passage suivant.
 */
export function resolveTargetBudget(params: {
  totalBudgetMs: number
  elapsedMs: number
  preferredBudgetMs?: number
}): number {
  const remaining = params.totalBudgetMs - params.elapsedMs - SWEEP_SAFETY_MARGIN_MS
  if (!Number.isFinite(remaining) || remaining < MIN_TARGET_BUDGET_MS) return 0
  const preferred = Math.max(
    MIN_TARGET_BUDGET_MS,
    Math.min(params.preferredBudgetMs ?? MAX_TARGET_BUDGET_MS, MAX_TARGET_BUDGET_MS),
  )
  return Math.min(preferred, remaining)
}

/** Budget minimal d'un appel transporteur (aligne sur le runner). */
const MIN_CALL_DURATION_MS = 1_500

/**
 * Estimation du nombre de colis traitables dans un budget, avec un temps
 * d'appel transporteur donne. Sert aux tests et au diagnostic : elle ne
 * pilote pas la selection SQL (qui reste la source de verite).
 */
export function estimatePassCapacity(budgetMs: number, callDurationMs: number): number {
  const usable = budgetMs - TARGET_FINALIZE_MARGIN_MS
  if (!Number.isFinite(usable) || usable < MIN_CALL_DURATION_MS) return 0
  const perCall = Math.max(MIN_CALL_DURATION_MS, callDurationMs)
  return Math.max(0, Math.floor(usable / perCall))
}

/** Progression reelle entre l'etat precedent et la couverture courante. */
export function computeQueueProgress(remainingBefore: number, remainingAfter: number): number {
  if (!Number.isFinite(remainingBefore) || !Number.isFinite(remainingAfter)) return 0
  return Math.max(0, remainingBefore - remainingAfter)
}

/**
 * Une file est consideree bloquee quand des colis restent a traiter et que le
 * plus ancien n'a pas ete relu depuis le seuil (30 min par defaut).
 */
export function isQueueStalled(params: {
  remaining: number
  oldestPendingSyncedAt: string | null | undefined
  now?: number
  thresholdMs?: number
}): boolean {
  if (!(params.remaining > 0)) return false
  if (!params.oldestPendingSyncedAt) return false
  const oldest = Date.parse(params.oldestPendingSyncedAt)
  if (!Number.isFinite(oldest)) return false
  const now = params.now ?? Date.now()
  return now - oldest > (params.thresholdMs ?? 30 * 60 * 1000)
}
