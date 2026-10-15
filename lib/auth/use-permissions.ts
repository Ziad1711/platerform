'use client'

import { useStore } from '@/lib/store-context'
import { Permission, hasPermission, Role } from './permissions'

/**
 * Rôle de l'utilisateur courant, dérivé du contexte magasins.
 *
 * Aucune requête dédiée n'est nécessaire : le rôle vient de l'appartenance
 * active déjà lue (bootstrap serveur, puis revalidation). Un changement de rôle
 * devient donc visible dès que la revalidation des accès a réussi, sans lecture
 * supplémentaire au changement de magasin.
 *
 * Ces informations servent à AFFICHER l'interface : elles ne remplacent jamais
 * les contrôles serveur, API et RLS des opérations sensibles.
 */
export function usePermissions(storeId: string | null) {
  const { accessibleStores, isStoresLoading } = useStore()

  const role = ((): Role | null => {
    // Magasin précis : son rôle (un identifiant non accessible n'accorde rien).
    if (storeId) {
      return accessibleStores.find((store) => store.id === storeId)?.role ?? null
    }

    // Argument `null` : rôle GLOBAL parmi les appartenances actives, quel que soit
    // le magasin actuellement sélectionné. Contrat historique conservé (écrans de
    // facturation, quotas, abonnement) : le rôle global ne doit pas disparaître
    // parce qu'un magasin précis est sélectionné. Règle du rôle le plus élevé
    // conservée à l'identique.
    const roles = accessibleStores
      .map((store) => store.role)
      .filter((value): value is Role => Boolean(value))
    if (roles.length === 0) return null

    const roleHierarchy: Role[] = [
      'owner',
      'admin',
      'marketer',
      'accountant',
      'stock_manager',
      'delivery',
      'confirmation',
      'viewer',
    ]
    for (const candidate of roleHierarchy) {
      if (roles.includes(candidate)) return candidate
    }
    return 'viewer'
  })()

  return {
    role,
    can: (permission: Permission) => hasPermission(role, permission),
    isAdminOrOwner: role === 'owner' || role === 'admin',
    /** true tant que le contexte magasins n'est pas confirmé : `can()` vaut false. */
    isLoading: isStoresLoading && accessibleStores.length === 0,
  }
}
