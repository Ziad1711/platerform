import type { AccessibleStore, StoreSelection } from '@/lib/auth/store-bootstrap'

/**
 * Préférence de sélection persistée (cookie + localStorage).
 *
 * C'est une PRÉFÉRENCE, jamais une autorisation : elle est liée à l'utilisateur
 * qui l'a posée et doit toujours être revalidée contre les appartenances actives
 * de l'utilisateur courant avant de devenir la sélection effective.
 */
export type StorePreference = {
  version: 1
  userId: string
  selection: { mode: 'all' } | { mode: 'store'; storeId: string }
}

export const STORE_PREFERENCE_COOKIE = 'jisra-store-preference'
export const STORE_PREFERENCE_STORAGE_KEY = 'jisra:store-preference:v1'
/** Cookie historique conservé comme miroir (middleware et routes existantes). */
export const LEGACY_STORE_COOKIE = 'current-store-id'
/** Marqueur inter-onglets signalant une mutation d'accès (aucune donnée privée). */
export const STORE_ACCESS_EVENT_KEY = 'jisra:store-access-event:v1'

const MAX_PREFERENCE_LENGTH = 512
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function safeDecode(raw: string): string {
  if (!raw.includes('%')) return raw
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * Lit une préférence brute (cookie ou localStorage). Toute entrée non fiable
 * (version inconnue, structure invalide, taille excessive) est rejetée : jamais
 * d'exception, jamais de valeur partielle exploitable.
 *
 * Le cookie est écrit sous forme encodée (les caractères `{`, `}` et `"` ne sont
 * pas des octets de cookie valides) : la valeur est donc décodée avant lecture.
 */
export function parseStorePreference(raw: string | null | undefined): StorePreference | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_PREFERENCE_LENGTH) return null
  try {
    const parsed = JSON.parse(safeDecode(raw)) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const candidate = parsed as {
      version?: unknown
      userId?: unknown
      selection?: { mode?: unknown; storeId?: unknown }
    }
    if (candidate.version !== 1) return null
    if (typeof candidate.userId !== 'string' || candidate.userId.length === 0) return null

    const selection = candidate.selection
    if (!selection || typeof selection !== 'object') return null
    if (selection.mode === 'all') {
      return { version: 1, userId: candidate.userId, selection: { mode: 'all' } }
    }
    if (selection.mode === 'store') {
      if (typeof selection.storeId !== 'string' || !UUID_RE.test(selection.storeId)) return null
      return {
        version: 1,
        userId: candidate.userId,
        selection: { mode: 'store', storeId: selection.storeId },
      }
    }
    return null
  } catch {
    return null
  }
}

export function serializeStorePreference(preference: StorePreference): string {
  return JSON.stringify(preference)
}

/**
 * Sélection déterministe : les magasins accessibles font autorité, la
 * préférence n'est appliquée que si elle appartient au même utilisateur et
 * désigne un magasin encore autorisé.
 */
export function resolveStoreSelection(
  stores: AccessibleStore[],
  preference: StorePreference | null,
  userId: string,
): StoreSelection {
  if (stores.length === 0) return { mode: 'none', storeId: null }

  if (preference && preference.userId === userId) {
    if (preference.selection.mode === 'all') return { mode: 'all', storeId: null }
    const wanted = preference.selection.storeId
    if (stores.some((store) => store.id === wanted)) {
      return { mode: 'store', storeId: wanted }
    }
  }

  // Défaut : un seul magasin → ce magasin ; plusieurs → « Tous les magasins ».
  if (stores.length === 1) return { mode: 'store', storeId: stores[0].id }
  return { mode: 'all', storeId: null }
}

/** Convertit une sélection effective en préférence persistable. */
export function selectionToPreference(
  selection: StoreSelection,
  userId: string,
): StorePreference | null {
  if (selection.mode === 'none') return null
  if (selection.mode === 'all') {
    return { version: 1, userId, selection: { mode: 'all' } }
  }
  return { version: 1, userId, selection: { mode: 'store', storeId: selection.storeId } }
}

/** `_rawStoreId` du contexte : `undefined` n'est plus produit (bootstrap connu). */
export function selectionToRawStoreId(selection: StoreSelection): string | null | undefined {
  if (selection.mode === 'store') return selection.storeId
  if (selection.mode === 'all') return null
  return undefined
}
