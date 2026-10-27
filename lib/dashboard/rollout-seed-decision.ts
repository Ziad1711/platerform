import { KPI_ROLLOUT_TTL_MS, type RolloutSeedResult } from './rollout'

/**
 * Décision d'application d'une graine rollout, isolée du rendu React.
 *
 * Elle est la SEULE règle utilisée par le contrôleur client : une graine n'est
 * appliquée que si son périmètre correspond exactement au périmètre courant, si
 * elle provient d'une lecture réussie et si son âge réel reste dans la fenêtre
 * de fraîcheur habituelle. Aucun mode n'est décidé ici : le payload repasse
 * ensuite par les contrôles existants (version, séquence, kill switch).
 */
export type RolloutSeedDecision =
  | { apply: true; updatedAt: number }
  | { apply: false; reason: 'SEED_FAILED' | 'NO_SCOPE' | 'SCOPE_MISMATCH' | 'SEED_STALE' }

export function decideRolloutSeed(input: {
  result: RolloutSeedResult
  /** Périmètre courant du contrôleur client. */
  storeIds: string[]
  storeIdsKey: string
  /** Horloge de réception (navigateur). */
  now: number
}): RolloutSeedDecision {
  const { result, storeIds, storeIdsKey, now } = input
  if (!result.ok) return { apply: false, reason: 'SEED_FAILED' }
  if (storeIds.length === 0 || result.storeIds.length === 0) {
    return { apply: false, reason: 'NO_SCOPE' }
  }
  const seededScope = [...result.storeIds].sort().join('|')
  if (seededScope !== storeIdsKey) return { apply: false, reason: 'SCOPE_MISMATCH' }

  // L'âge vient du serveur : une décision obtenue il y a plus longtemps que la
  // fenêtre de fraîcheur ne devient jamais fraîche du seul fait de sa réception.
  const ageMs = Number.isFinite(result.ageMs) ? Math.max(0, result.ageMs) : Number.POSITIVE_INFINITY
  if (ageMs > KPI_ROLLOUT_TTL_MS) return { apply: false, reason: 'SEED_STALE' }

  return { apply: true, updatedAt: now - ageMs }
}
