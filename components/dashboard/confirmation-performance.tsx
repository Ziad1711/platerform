'use client'

import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'
import { formatCurrency, formatNumber, getPeriodRange } from '@/lib/utils'

type AgentRow = {
  id: string
  name: string
  totalOrders: number
  confirmedOrders: number
  deliveredOrders: number
  rejectedOrders: number
  potentialCommission: number
  earnedCommission: number
  paidCommission: number
  confirmationRate: number
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
        return {
          agents: [],
          totals: {
            totalOrders: 0,
            confirmedOrders: 0,
            deliveredOrders: 0,
            rejectedOrders: 0,
            potentialCommission: 0,
            earnedCommission: 0,
            paidCommission: 0,
          },
          globalRate: 0,
        }
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
            agent_id: string
            agent_name: string
            total_orders: number
            confirmed_orders: number
            delivered_orders: number
            rejected_orders: number
            potential_commission: number
            earned_commission: number
            paid_commission: number
            confirmation_rate: number
          }>
        })
      )

      // Aggregate agents by id
      const agentMap = new Map<string, AgentRow>()

      for (const rows of results) {
        for (const row of rows) {
          const id = String(row.agent_id || '')
          const existing = agentMap.get(id) || {
            id,
            name: String(row.agent_name || 'Agent'),
            totalOrders: 0,
            confirmedOrders: 0,
            deliveredOrders: 0,
            rejectedOrders: 0,
            potentialCommission: 0,
            earnedCommission: 0,
            paidCommission: 0,
            confirmationRate: 0,
          }
          existing.totalOrders += Number(row.total_orders || 0)
          existing.confirmedOrders += Number(row.confirmed_orders || 0)
          existing.deliveredOrders += Number(row.delivered_orders || 0)
          existing.rejectedOrders += Number(row.rejected_orders || 0)
          existing.potentialCommission += Number(row.potential_commission || 0)
          existing.earnedCommission += Number(row.earned_commission || 0)
          existing.paidCommission += Number(row.paid_commission || 0)
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
          acc.deliveredOrders += a.deliveredOrders
          acc.rejectedOrders += a.rejectedOrders
          acc.potentialCommission += a.potentialCommission
          acc.earnedCommission += a.earnedCommission
          acc.paidCommission += a.paidCommission
          return acc
        },
        {
          totalOrders: 0,
          confirmedOrders: 0,
          deliveredOrders: 0,
          rejectedOrders: 0,
          potentialCommission: 0,
          earnedCommission: 0,
          paidCommission: 0,
        }
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
          {data?.agents?.length ? (
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
                <div className="text-xs text-muted-foreground">Commission acquise</div>
                <div className="text-2xl font-bold text-fuchsia-600 mt-1">{formatCurrency(data?.totals.earnedCommission || 0)}</div>
              </div>
            </div>
          ) : null}

          {data?.agents?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 text-sm font-medium text-muted-foreground">Agent</th>
                    <th className="text-left p-3 text-sm font-medium text-muted-foreground">Traitées</th>
                    <th className="text-left p-3 text-sm font-medium text-muted-foreground">Confirmées</th>
                    <th className="text-left p-3 text-sm font-medium text-muted-foreground">Livrées</th>
                    <th className="text-left p-3 text-sm font-medium text-muted-foreground">Rejetées</th>
                    <th className="text-left p-3 text-sm font-medium text-muted-foreground">Taux</th>
                    <th className="text-left p-3 text-sm font-medium text-muted-foreground">Commission acquise</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((agent) => (
                    <tr key={agent.id} className="border-b border-border hover:bg-secondary/50">
                      <td className="p-3 font-medium text-foreground">{agent.name}</td>
                      <td className="p-3 text-foreground">{formatNumber(agent.totalOrders)}</td>
                      <td className="p-3 text-emerald-600 font-semibold">{formatNumber(agent.confirmedOrders)}</td>
                      <td className="p-3 text-foreground">{formatNumber(agent.deliveredOrders)}</td>
                      <td className="p-3 text-red-500 font-semibold">{formatNumber(agent.rejectedOrders)}</td>
                      <td className="p-3 text-blue-600 font-semibold">{agent.confirmationRate.toFixed(1)}%</td>
                      <td className="p-3 text-fuchsia-600 font-semibold">{formatCurrency(agent.earnedCommission)}</td>
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
