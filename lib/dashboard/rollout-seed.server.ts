import 'server-only'

import type { AccessibleStore, StoreSelection } from '@/lib/auth/store-bootstrap'
import { getAppBootstrap } from '@/lib/auth/store-bootstrap.server'
import { getRequestClient } from '@/lib/supabase/server'
import {
  KPI_ROLLOUT_SEED_SERVER_TIMEOUT_MS,
  fetchKpiRollout,
  type KpiRolloutPayload,
  type RolloutSeedResult,
} from './rollout'

/**
 * Configuration de rollout anticipée côté serveur.
 *
 * Elle est lue avec le client UTILISATEUR (cookies de session, RLS et
 * permissions inchangées), exactement comme le fait le navigateur. Aucune
 * décision n'est prise ici : la charge utile est transmise telle quelle et devra
 * franchir les contrôles existants (périmètre, fraîcheur, version, kill switch)
 * avant toute lecture financière.
 *
 * Le résultat ne rejette jamais : un échec laisse simplement le navigateur faire
 * sa propre lecture.
 */
function rolloutStoreIds(stores: AccessibleStore[], selection: StoreSelection): string[] {
  if (selection.mode === 'store') {
    return stores.some((store) => store.id === selection.storeId) ? [selection.storeId] : []
  }
  if (selection.mode === 'all') return stores.map((store) => store.id)
  return []
}

export async function loadRolloutSeed(userId: string): Promise<RolloutSeedResult> {
  if (!userId) return { ok: false, storeIds: [], reason: 'MISSING_USER' }

  const bootstrap = await getAppBootstrap(userId).catch(() => null)
  if (!bootstrap || bootstrap.status !== 'ready') {
    return { ok: false, storeIds: [], reason: 'STORE_ACCESS_UNAVAILABLE' }
  }

  const storeIds = rolloutStoreIds(bootstrap.access.stores, bootstrap.selection)
  if (storeIds.length === 0) return { ok: false, storeIds, reason: 'NO_STORE_SCOPE' }

  const supabase = await getRequestClient().catch(() => null)
  if (!supabase) return { ok: false, storeIds, reason: 'CLIENT_UNAVAILABLE' }

  // Budget propre à l'anticipation : ne jamais retenir longtemps le flux RSC.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), KPI_ROLLOUT_SEED_SERVER_TIMEOUT_MS)
  const startedAt = Date.now()
  try {
    const payload = await fetchKpiRollout(supabase, storeIds, controller.signal)
    // Âge réel de la décision : mesuré côté serveur, il traverse sans décalage
    // d'horloge et permet au navigateur de refuser une graine déjà expirée.
    return { ok: true, payload, storeIds, ageMs: Date.now() - startedAt }
  } catch {
    return { ok: false, storeIds, reason: 'ROLLOUT_UNAVAILABLE' }
  } finally {
    clearTimeout(timer)
  }
}
