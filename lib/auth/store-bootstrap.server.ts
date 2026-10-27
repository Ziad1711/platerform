import 'server-only'

import { cookies } from 'next/headers'
import { cache } from 'react'
import { getRequestClient } from '@/lib/supabase/server'
import { readSessionKey, STORE_ACCESS_UNAVAILABLE } from './store-bootstrap'
import type { AppBootstrap } from './store-bootstrap'
import { loadStoreAccess, STORE_ACCESS_TIMEOUT_MS } from './store-access'
import {
  parseStorePreference,
  resolveStoreSelection,
  STORE_PREFERENCE_COOKIE,
} from '@/lib/store-selection'

/**
 * Prépare le contexte privé minimal APRÈS vérification d'identité : magasins
 * réellement accessibles, rôles des appartenances actives, référence de session
 * et sélection déjà validée.
 *
 * Ce module est réservé au serveur (rendu RSC). Il ne transmet jamais de jeton,
 * de cookie ni d'objet session : seule la référence non secrète `session_id`
 * circule, pour que le navigateur ne partage pas le cache de deux sessions.
 *
 * `userId` doit provenir de `getServerUserResult()` : la lecture ci-dessous reste
 * de toute façon filtrée sur les appartenances actives de CET utilisateur et
 * soumise à la RLS.
 */
export async function buildAppBootstrap(userId: string): Promise<AppBootstrap> {
  const unauth: AppBootstrap = {
    version: 1,
    userId,
    sessionKey: '',
    status: 'unavailable',
    access: null,
    selection: null,
    errorCode: 'SESSION_REFERENCE_UNAVAILABLE',
  }

  if (!userId) return unauth

  const supabase = await getRequestClient().catch(() => null)
  if (!supabase) return unauth

  let sessionKey = ''
  try {
    const { data, error } = await supabase.auth.getSession()
    const session = data?.session ?? null

    // La session doit exister ET désigner la même identité que celle vérifiée par
    // l'API Auth. Sans référence de session exploitable, on ne monte pas la
    // frontière privée : deux sessions distinctes partageraient le même cache.
    if (error || !session?.access_token || session.user?.id !== userId) return unauth
    sessionKey = readSessionKey(session.access_token)
    if (!sessionKey) return unauth
  } catch {
    return unauth
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), STORE_ACCESS_TIMEOUT_MS)
    try {
      const access = await loadStoreAccess(supabase, userId, controller.signal)
      const cookieStore = await cookies()
      const preference = parseStorePreference(
        cookieStore.get(STORE_PREFERENCE_COOKIE)?.value ?? null,
      )

      return {
        version: 1,
        userId,
        sessionKey,
        status: 'ready',
        access,
        selection: resolveStoreSelection(access.stores, preference, userId),
      }
    } finally {
      clearTimeout(timer)
    }
  } catch {
    // Panne/lenteur de lecture : jamais un succès vide ni un faux onboarding.
    return {
      version: 1,
      userId,
      sessionKey,
      status: 'unavailable',
      access: null,
      selection: null,
      errorCode: STORE_ACCESS_UNAVAILABLE,
    }
  }
}

/**
 * Mutualisation de la préparation d'accès sur la requête serveur courante.
 *
 * `cache()` est borné au rendu de la requête : le layout protégé et la page
 * Dashboard partagent la même lecture. Aucun cache n'est partagé entre
 * utilisateurs, sessions ou requêtes, et la revalidation navigateur des accès
 * reste inchangée.
 */
export const getAppBootstrap = cache(buildAppBootstrap)

