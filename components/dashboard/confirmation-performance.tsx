'use client'

import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'
import { formatCurrency, getPeriodRange } from '@/lib/utils'

type AgentRow = {
  id: string
  name: string
  language: string
  commissionPerOrder: number
  totalOrders: number
  confirmedOrders: number
  rejectedOrders: number
  confirmationRate: number
  totalCommission: number
}

export default function ConfirmationPerformance() {
  const { currentStoreId, selectedPeriod, customStartDate, customEndDate, accessibleStoreIds, isStoresLoading } = useStore()
  const supabase = createClient()
  const periodRange = getPeriodRange(selectedPeriod, { customStartDate, customEndDate })

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-confirmation-performance', currentStoreId, selectedPeriod, customStartDate, customEndDate, accessibleStoreIds],
    enabled: !isStoresLoading,
    queryFn: async () => {
      const storeIds = currentStoreId ? [currentStoreId] : accessibleStoreIds

      if (storeIds.length === 0) {
        return { agents: [], totals: { totalOrders: 0, confirmedOrders: 0, rejectedOrders: 0, totalCommission: 0 }, globalRate: 0 }
      }

      const results = await Promise.all(
        storeIds.map(async (storeId) => {
          const { data: rows, error } = await supabase.rpc('rpc_dashboard_confirmation_performance', {
            p_store_ids: [storeId],
            p_start_date: periodRange.start ? periodRange.start.toISOString() : null,
            p_end_date: periodRange.end ? periodRange.end.toISOString() : null,
          })
          if (error) throw error
          return (rows || []) as Array<{
            id: string
            name: string
            language: string
            commission_per_order: number
            total_orders: number
            confirmed_orders: number
            rejected_orders: number
            confirmation_rate: number
            total_commission: number
          }>
        })
      )

      // Aggregate agents by id
      const agentMap = new Map<string, AgentRow>()

      for (const rows of results) {
        for (const row of rows) {
          const id = String(row.id || '')
          const existing = agentMap.get(id) || {
            id,
            name: String(row.name || 'Agent'),
            language: String(row.language || '-'),
            commissionPerOrder: Number(row.commission_per_order || 0),
            totalOrders: 0,
            confirmedOrders: 0,
            rejectedOrders: 0,
            confirmationRate: 0,
            totalCommission: 0,
          }
          existing.totalOrders += Number(row.total_orders || 0)
          existing.confirmedOrders += Number(row.confirmed_orders || 0)
          existing.rejectedOrders += Number(row.rejected_orders || 0)
          existing.totalCommission += Number(row.total_commission || 0)
          agentMap.set(id, existing)
        }
      }

      const agents: AgentRow[] = Array.from(agentMap.values()).map((a) => ({
        ...a,
        confirmationRate: a.totalOrders > 0 ? (a.confirmedOrders / a.totalOrders) * 100 : 0,
      }))

      const totals = agents.reduce(
        (acc, a) => {
          acc.totalOrders += a.totalOrders
          acc.confirmedOrders += a.confirmedOrders
          acc.rejectedOrders += a.rejectedOrders
          acc.totalCommission += a.totalCommission
          return acc
        },
        { totalOrders: 0, confirmedOrders: 0, rejectedOrders: 0, totalCommission: 0 }
      )

      const globalRate = totals.totalOrders > 0 ? (totals.confirmedOrders / totals.totalOrders) * 100 : 0

      return { agents, totals, globalRate }
    },
  })


  return (
    <div className="bg-card rounded-xl shadow">
      <div className="p-6 border-b border-border">
        <h3 className="text-lg font-semibold text-foreground">Confirmation & performance agents</h3>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Chargement...</div>
      ) : (
        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-lg border border-border p-4">
              <div className="text-xs text-muted-foreground">Commandes traitées</div>
              <div className="text-2xl font-bold text-foreground mt-1">{data?.totals.totalOrders || 0}</div>
            </div>
            <div className="rounded-lg border border-border p-4">
              <div className="text-xs text-muted-foreground">Commandes confirmées</div>
              <div className="text-2xl font-bold text-emerald-600 mt-1">{data?.totals.confirmedOrders || 0}</div>
            </div>
            <div className="rounded-lg border border-border p-4">
              <div className="text-xs text-muted-foreground">Taux de confirmation</div>
              <div className="text-2xl font-bold text-blue-600 mt-1">{(data?.globalRate || 0).toFixed(1)}%</div>
            </div>
            <div className="rounded-lg border border-border p-4">
              <div className="text-xs text-muted-foreground">Commission totale</div>
              <div className="text-2xl font-bold text-fuchsia-600 mt-1">{formatCurrency(data?.totals.totalCommission || 0)}</div>
            </div>
          </div>

          {data?.agents?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 text-sm font-medium text-muted-foreground">Agent</th>
                    <th className="text-left p-3 text-sm font-medium text-muted-foreground">Langue</th>
                    <th className="text-left p-3 text-sm font-medium text-muted-foreground">Traitées</th>
                    <th className="text-left p-3 text-sm font-medium text-muted-foreground">Confirmées</th>
                    <th className="text-left p-3 text-sm font-medium text-muted-foreground">Taux</th>
                    <th className="text-left p-3 text-sm font-medium text-muted-foreground">Commission</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((agent) => (
                    <tr key={agent.id} className="border-b border-border hover:bg-secondary/50">
                      <td className="p-3 font-medium text-foreground">{agent.name}</td>
                      <td className="p-3 text-muted-foreground">{agent.language}</td>
                      <td className="p-3 text-foreground">{agent.totalOrders}</td>
                      <td className="p-3 text-emerald-600 font-semibold">{agent.confirmedOrders}</td>
                      <td className="p-3 text-blue-600 font-semibold">{agent.confirmationRate.toFixed(1)}%</td>
                      <td className="p-3 text-fuchsia-600 font-semibold">{formatCurrency(agent.totalCommission)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-6">Pas de données confirmation sur cette période</div>
          )}
        </div>
      )}
    </div>
  )
}
