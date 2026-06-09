'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useStore } from '@/lib/store-context'
import { Permission, hasPermission, Role } from './permissions'

export function usePermissions(storeId: string | null) {
  const supabase = createClient()
  const { userId } = useStore()

  const { data: role } = useQuery({
    queryKey: ['member-role', storeId, userId],
    enabled: !!userId,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      if (!userId) return null

      if (storeId) {
        // Mode store spécifique
        const { data } = await supabase
          .from('store_members')
          .select('role')
          .eq('store_id', storeId)
          .eq('user_id', userId)
          .eq('status', 'active')
          .maybeSingle()
        return (data?.role as Role | null | undefined) ?? null
      }

      // Mode "Tous les stores" : on prend le rôle le plus élevé
      const { data: memberships } = await supabase
        .from('store_members')
        .select('role')
        .eq('user_id', userId)
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
