'use client'

import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'

export default function PersonnelPage() {
  const { currentStoreId } = useStore()
  const supabase = createClient()

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['settings-personnel-members', currentStoreId],
    queryFn: async () => {
      let query = supabase
        .from('store_members')
        .select('id, role, user_id, profiles(full_name, first_name, last_name)')
        .order('created_at', { ascending: false })

      if (currentStoreId) {
        query = query.eq('store_id', currentStoreId)
      }

      const { data, error } = await query
      if (error) throw error
      return data || []
    },
  })

  return (
    <div className="space-y-6 pt-2 sm:pt-0">

      <div className="bg-card rounded-xl shadow p-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">Personnel</h2>
        <p className="text-sm text-muted-foreground">Membres du store actif.</p>
      </div>

      <div className="bg-card rounded-xl shadow overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Chargement...</div>
        ) : members.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">Aucun membre trouvé.</div>
        ) : (
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-secondary">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Nom</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Rôle</th>
              </tr>
            </thead>
            <tbody className="bg-card divide-y divide-border">
              {members.map((member: any) => {
                const profile = member?.profiles
                const fullName = profile?.full_name || `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || 'Utilisateur'

                return (
                  <tr key={member.id}>
                    <td className="px-6 py-4 text-sm text-foreground">{fullName}</td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">{member.role || '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
