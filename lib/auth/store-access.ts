import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeRole } from './store-bootstrap'
import type { AccessibleStore, StoreAccessSnapshot } from './store-bootstrap'

/**
 * Lecture unique des magasins accessibles à l'utilisateur courant.
 *
 * La lecture est filtrée sur SES appartenances actives et reste soumise à la RLS
 * des politiques `store_members` / `stores` : elle ne peut donc pas révéler un
 * magasin non autorisé. Elle est partagée par le bootstrap serveur et par la
 * revalidation navigateur, afin qu'une seule règle existe des deux côtés.
 */
export class StoreAccessError extends Error {
  constructor(message = 'STORE_ACCESS_READ_FAILED') {
    super(message)
    this.name = 'StoreAccessError'
  }
}

/** Borne d'attente d'une lecture d'accès (une seule tentative, pas de retry serveur). */
export const STORE_ACCESS_TIMEOUT_MS = 12_000

/**
 * Erreurs signalant UNIQUEMENT que la relation `stores` n'est pas exploitable par
 * l'embarquement PostgREST (schéma non rechargé, relation ambiguë). Dans ce cas
 * seulement le repli en deux lectures est légitime : toute autre erreur est un
 * échec réel de lecture et ne doit jamais être déguisée en « repli ».
 */
const EMBED_UNAVAILABLE_CODES = new Set(['PGRST200', 'PGRST201'])

function isEmbedUnavailable(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false
  if (typeof error.code === 'string' && EMBED_UNAVAILABLE_CODES.has(error.code)) return true
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : ''
  // Message de PostgREST quand la relation n'est pas résolue par le cache de schéma.
  return message.includes('could not find a relationship')
}

type MembershipRow = {
  store_id?: unknown
  role?: unknown
  store?: unknown
}

function pickStore(relation: unknown): { id?: unknown; name?: unknown; logo_url?: unknown; created_at?: unknown } | null {
  if (!relation) return null
  // PostgREST peut renvoyer la relation en objet (many-to-one) ou en tableau.
  const candidate = Array.isArray(relation) ? relation[0] : relation
  if (!candidate || typeof candidate !== 'object') return null
  return candidate as { id?: unknown; name?: unknown; logo_url?: unknown; created_at?: unknown }
}

/**
 * Normalise les lignes lues en instantané d'accès : identifiants dédupliqués,
 * noms obligatoires, rôles validés, ordre stable (création puis id).
 */
function buildSnapshot(rows: MembershipRow[]): StoreAccessSnapshot {
  const byId = new Map<string, AccessibleStore & { createdAt: string }>()

  for (const raw of rows) {
    const store = pickStore(raw.store)
    const id = String(store?.id ?? raw.store_id ?? '')
    const name = typeof store?.name === 'string' ? store.name : ''
    // Une ligne rattachée à une appartenance mais sans magasin exploitable signale
    // une réponse mal formée : jamais un succès silencieux (vide ou tronqué) qui
    // ressemblerait à « aucun magasin ».
    if (!id || !name) throw new StoreAccessError('STORE_ACCESS_MALFORMED_RESPONSE')
    const logo = store?.logo_url
    const createdAt = typeof store?.created_at === 'string' ? store.created_at : ''
    byId.set(id, {
      id,
      name,
      logo_url: typeof logo === 'string' ? logo : null,
      role: normalizeRole(raw.role),
      createdAt,
    })
  }

  const stores = Array.from(byId.values())
    .sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
      return a.id < b.id ? -1 : 1
    })
    .map(({ id, name, logo_url, role }) => ({ id, name, logo_url, role }))

  return { stores, fetchedAt: Date.now() }
}

export async function loadStoreAccess(
  supabase: SupabaseClient,
  userId: string,
  signal?: AbortSignal,
): Promise<StoreAccessSnapshot> {
  if (!userId) throw new StoreAccessError('STORE_ACCESS_MISSING_USER')

  const { data, error } = await supabase
    .from('store_members')
    .select(`
      store_id,
      role,
      store:stores!inner(id, name, logo_url, created_at)
    `)
    .eq('user_id', userId)
    .eq('status', 'active')
    .abortSignal(signal as never)

  if (signal?.aborted) throw new StoreAccessError('STORE_ACCESS_ABORTED')
  if (!error) return buildSnapshot(((data || []) as unknown as MembershipRow[]))

  // Erreur qui n'est PAS un problème de relation : échec réel de lecture (panne,
  // droits, lenteur). Elle est propagée telle quelle — jamais transformée en
  // succès vide ni présentée comme « aucun magasin ».
  if (!isEmbedUnavailable(error)) {
    throw new StoreAccessError(error.message || 'STORE_ACCESS_READ_FAILED')
  }

  // Repli sans changement de base : les deux lectures historiques (appartenances
  // puis magasins), déjà éprouvées en production, si le regroupement PostgREST
  // n'est pas disponible pour ce client. Une seule règle de filtrage subsiste :
  // appartenances `active` de l'utilisateur, puis magasins autorisés par la RLS.
  const { data: memberships, error: membershipsError } = await supabase
    .from('store_members')
    .select('store_id, role')
    .eq('user_id', userId)
    .eq('status', 'active')
    .abortSignal(signal as never)

  if (membershipsError) {
    throw new StoreAccessError(membershipsError.message || 'STORE_ACCESS_READ_FAILED')
  }
  if (signal?.aborted) throw new StoreAccessError('STORE_ACCESS_ABORTED')

  const roleByStore = new Map<string, unknown>()
  for (const row of (memberships || []) as { store_id?: unknown; role?: unknown }[]) {
    const storeId = String(row.store_id ?? '')
    if (storeId) roleByStore.set(storeId, row.role)
  }

  const storeIds = Array.from(roleByStore.keys())
  if (storeIds.length === 0) return { stores: [], fetchedAt: Date.now() }

  const { data: stores, error: storesError } = await supabase
    .from('stores')
    .select('id, name, logo_url, created_at')
    .in('id', storeIds)
    .order('created_at', { ascending: true })
    .abortSignal(signal as never)

  if (storesError) {
    throw new StoreAccessError(storesError.message || 'STORE_ACCESS_READ_FAILED')
  }
  if (signal?.aborted) throw new StoreAccessError('STORE_ACCESS_ABORTED')

  return buildSnapshot(
    ((stores || []) as { id?: unknown; name?: unknown; logo_url?: unknown; created_at?: unknown }[]).map(
      (store) => ({
        store_id: store.id,
        role: roleByStore.get(String(store.id ?? '')),
        store,
      }),
    ),
  )
}
