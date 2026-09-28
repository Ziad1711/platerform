import type { Role } from './permissions'
import type { createClient } from '@/lib/supabase/server'

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>

export type UserAccess = {
  role: Role | null
  /** true si l'utilisateur a au moins un store accessible actif */
  hasStore: boolean
  /** true si la lecture des appartenances a échoué (jamais assimilé à « aucun store ») */
  lookupFailed: boolean
}

/**
 * Détermine l'accès réel d'un utilisateur à un store, à partir des
 * appartenances **actives** (`store_members.status = 'active'`).
 *
 * Deux points importants :
 * - lecture via `.limit(1)` et non `.maybeSingle()` : un utilisateur membre de
 *   plusieurs stores fait échouer `maybeSingle()` (« multiple rows returned »),
 *   ce qui était interprété à tort comme « aucun store » ;
 * - une erreur de lecture est signalée par `lookupFailed` au lieu d'être
 *   confondue avec l'absence de store.
 *
 * La détection est la même partout (`/login`, `/signup`, `/auth/callback`,
 * `/api/stores`) : appartenance active, puis propriété du store en filet de
 * sécurité — la RLS `stores` autorise `owner_user_id = auth.uid()`.
 */
export async function getUserAccess(
  supabase: ServerSupabaseClient,
  userId: string,
): Promise<UserAccess> {
  const { data, error } = await supabase
    .from('store_members')
    .select('role')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)

  if (error) {
    return { role: null, hasStore: false, lookupFailed: true }
  }

  const role = ((data?.[0]?.role as Role | undefined) ?? null)
  if (role) {
    return { role, hasStore: true, lookupFailed: false }
  }

  const { data: owned, error: ownedError } = await supabase
    .from('stores')
    .select('id')
    .eq('owner_user_id', userId)
    .limit(1)

  if (ownedError) {
    return { role: null, hasStore: false, lookupFailed: true }
  }

  if ((owned?.length ?? 0) > 0) {
    return { role: 'owner', hasStore: true, lookupFailed: false }
  }

  return { role: null, hasStore: false, lookupFailed: false }
}
