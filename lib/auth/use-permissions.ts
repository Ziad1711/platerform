'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Permission, hasPermission, Role } from './permissions'

export function usePermissions(storeId: string | null) {
  const supabase = createClient()

  const { data: role } = useQuery({
    queryKey: ['member-role', storeId],
    // Quand storeId est null ("Tous les stores"), on charge le rôle le plus élevé
    // parmi tous les stores accessibles pour déterminer les permissions globales
    enabled: true,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null

      if (storeId) {
        // Mode store spécifique
        const { data } = await supabase
          .from('store_members')
          .select('role')
          .eq('store_id', storeId)
          .eq('user_id', user.id)
          .eq('status', 'active')
          .maybeSingle()
        return (data?.role as Role | null | undefined) ?? null
      }

      // Mode "Tous les stores" : on prend le rôle le plus élevé
      const { data: memberships } = await supabase
        .from('store_members')
        .select('role')
        .eq('user_id', user.id)
        .eq('status', 'active')

      if (!memberships || memberships.length === 0) return null

      const roleHierarchy: Role[] = ['owner', 'admin', 'marketer', 'accountant', 'stock_manager', 'delivery', 'confirmation', 'viewer']
      const roles = memberships.map(m => m.role as Role)
      for (const r of roleHierarchy) {
        if (roles.includes(r)) return r
      }
      return 'viewer'
    },
  })

  return {
    role: role ?? null,
    can: (permission: Permission) => hasPermission(role ?? null, permission),
    isAdminOrOwner: role === 'owner' || role === 'admin',
  }
}
