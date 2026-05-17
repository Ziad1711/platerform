'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Permission, hasPermission, Role } from './permissions'

export function usePermissions(storeId: string | null) {
  const supabase = createClient()

  const { data: role } = useQuery({
    queryKey: ['member-role', storeId],
    enabled: !!storeId,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null
      const { data } = await supabase
        .from('store_members')
        .select('role')
        .eq('store_id', storeId!)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle()
      return (data?.role as Role | null | undefined) ?? null
    },
  })

  return {
    role: role ?? null,
    can: (permission: Permission) => hasPermission(role ?? null, permission),
    isAdminOrOwner: role === 'owner' || role === 'admin',
  }
}
