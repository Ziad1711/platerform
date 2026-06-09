'use client'

import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'
import { useStore } from '@/lib/store-context'

export default function AbonnementPage() {
  const supabase = createClient()
  const { userId } = useStore()

  const { data: subscription, isLoading } = useQuery({
    queryKey: ['settings-subscription-current', userId],
    queryFn: async () => {
      if (!userId) return null


      const { data, error } = await supabase
        .from('subscriptions')
        .select('status, amount_paid, currency, started_at, expires_at, plans(name, price)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) throw error
      return data
    },
  })

  const { data: subscriptionsHistory = [] } = useQuery({
    queryKey: ['settings-subscription-history-dashboard', userId],
    queryFn: async () => {
      if (!userId) return []


      const { data, error } = await supabase
        .from('subscriptions')
        .select('id, status, amount_paid, currency, started_at, expires_at, plans(name)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(12)

      if (error) throw error
      return data || []
    },
  })

  const { data: plans = [] } = useQuery({
    queryKey: ['settings-plans-list-dashboard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plans')
        .select('id, name, price, order_limit')
        .order('price', { ascending: true })

      if (error) throw error
      return data || []
    },
  })

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-xl shadow p-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">Abonnement</h2>
        <p className="text-sm text-muted-foreground">Détails du plan actuel.</p>
      </div>

      <div className="bg-card rounded-xl shadow p-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Chargement...</p>
        ) : !subscription ? (
          <p className="text-sm text-muted-foreground">Aucun abonnement actif.</p>
        ) : (
          <div className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">Plan:</span> {(subscription as any)?.plans?.name || '-'}</p>
            <p><span className="text-muted-foreground">Statut:</span> {subscription.status || '-'}</p>
            <p><span className="text-muted-foreground">Montant:</span> {subscription.amount_paid ?? 0} {subscription.currency || ''}</p>
            <p><span className="text-muted-foreground">Début:</span> {subscription.started_at ? new Date(subscription.started_at).toLocaleString() : '-'}</p>
            <p><span className="text-muted-foreground">Fin:</span> {subscription.expires_at ? new Date(subscription.expires_at).toLocaleString() : '-'}</p>
          </div>
        )}
      </div>

      <div id="upgrade" className="bg-card rounded-xl shadow p-6 space-y-3">
        <h3 className="text-base font-semibold text-foreground">Upgrade</h3>
        <p className="text-sm text-muted-foreground">Choisissez un plan supérieur.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {plans.map((plan: any) => (
            <div key={plan.id} className="border rounded-lg p-3">
              <p className="text-sm font-semibold text-foreground">{plan.name}</p>
              <p className="text-xs text-muted-foreground">{plan.price ?? 0} MAD / mois</p>
              <p className="text-xs text-muted-foreground">Limite commandes: {plan.order_limit ?? '-'}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card rounded-xl shadow p-6">
        <h3 className="text-base font-semibold text-foreground mb-3">Historique des abonnements</h3>
        <div className="border rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-secondary">
              <tr>
                <th className="px-4 py-2 text-left text-xs uppercase text-muted-foreground">Plan</th>
                <th className="px-4 py-2 text-left text-xs uppercase text-muted-foreground">Période</th>
                <th className="px-4 py-2 text-left text-xs uppercase text-muted-foreground">Montant</th>
                <th className="px-4 py-2 text-left text-xs uppercase text-muted-foreground">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {subscriptionsHistory.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-muted-foreground">Aucun historique disponible.</td>
                </tr>
              ) : (
                subscriptionsHistory.map((row: any) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3">{row?.plans?.name || '-'}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.started_at ? new Date(row.started_at).toLocaleDateString() : '-'} → {row.expires_at ? new Date(row.expires_at).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.amount_paid ?? 0} {row.currency || 'MAD'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.status || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
