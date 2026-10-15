import type { Role } from '@/lib/auth/permissions'

/**
 * Types partagés du démarrage de l'espace privé.
 *
 * Un seul instantané circule : celui préparé côté serveur après vérification
 * d'identité, puis celui relu côté navigateur lors d'une revalidation. Ces types
 * ne contiennent AUCUN secret (ni JWT, ni cookie, ni objet session) : la clé de
 * session n'est qu'une référence de partitionnement de cache.
 */

export type AccessibleStore = {
  id: string
  name: string
  logo_url: string | null
  /** Rôle de l'utilisateur pour ce store (appartenance active) ; null si inconnu. */
  role: Role | null
}

/**
 * Sélection EFFECTIVE (toujours validée contre les appartenances actives).
 * `none` = aucun magasin accessible, `all` = « Tous les magasins » explicite,
 * `store` = magasin précis autorisé.
 */
export type StoreSelection =
  | { mode: 'none'; storeId: null }
  | { mode: 'all'; storeId: null }
  | { mode: 'store'; storeId: string }

/** Instantané confirmé des accès (liste + horodatage de la dernière lecture réussie). */
export type StoreAccessSnapshot = {
  stores: AccessibleStore[]
  fetchedAt: number
}

/**
 * Bootstrap transmis du layout serveur au StoreProvider.
 *
 * - `ready` : les accès ont été lus. `stores` peut être vide (zéro magasin
 *   confirmé) mais jamais vide à cause d'une erreur.
 * - `unavailable` : la lecture a échoué. Aucun état vide n'est simulé : les
 *   consommateurs applicatifs ne doivent pas être montés.
 */
export type AppBootstrap = {
  version: 1
  userId: string
  /** Référence non secrète de la session Auth (claim `session_id`). */
  sessionKey: string
} & (
  | {
      status: 'ready'
      access: StoreAccessSnapshot
      selection: StoreSelection
    }
  | {
      status: 'unavailable'
      access: null
      selection: null
      /** Cause technique précise : jamais confondue avec « aucun magasin ». */
      errorCode: StoreBootstrapErrorCode
    }
)

export type StoreBootstrapErrorCode =
  /** La lecture des appartenances/magasins a échoué (panne, lenteur, erreur). */
  | 'STORE_ACCESS_UNAVAILABLE'
  /** La session serveur n'a pas pu être corrélée à l'identité vérifiée. */
  | 'SESSION_REFERENCE_UNAVAILABLE'

export const STORE_ACCESS_UNAVAILABLE = 'STORE_ACCESS_UNAVAILABLE' as const

const ROLES: readonly string[] = [
  'owner',
  'admin',
  'confirmation',
  'delivery',
  'stock_manager',
  'accountant',
  'marketer',
  'viewer',
]

/** Normalise un rôle lu en base : une valeur inconnue n'accorde aucun droit. */
export function normalizeRole(value: unknown): Role | null {
  if (typeof value !== 'string') return null
  return ROLES.includes(value) ? (value as Role) : null
}

/**
 * Lit le claim `session_id` d'un JWT d'accès (décodage local, sans vérification).
 * Ce décodage n'authentifie RIEN : il sert uniquement à partitionner le cache
 * privé entre deux sessions distinctes. Renvoie '' si la valeur est absente.
 */
export function readSessionKey(accessToken: string | null | undefined): string {
  if (!accessToken) return ''
  try {
    const parts = accessToken.split('.')
    if (parts.length < 2) return ''
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const payload = JSON.parse(atob(padded)) as { session_id?: unknown }
    return typeof payload.session_id === 'string' ? payload.session_id : ''
  } catch {
    return ''
  }
}

/** Map store_id → rôle, utilisée pour comparer deux instantanés d'accès. */
export function toAccessMap(stores: AccessibleStore[]): Record<string, Role | null> {
  const map: Record<string, Role | null> = {}
  for (const store of stores) map[store.id] = store.role
  return map
}
