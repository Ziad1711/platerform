'use client'

import { TrendingUp, TrendingDown } from 'lucide-react'
import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'
import { formatCurrency, getPeriodRange } from '@/lib/utils'

export default function ProfitChart() {
  const { currentStoreId, selectedPeriod, accessibleStoreIds, isStoresLoading } = useStore()
  const supabase = createClient()
  const periodRange = getPeriodRange(selectedPeriod)

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-profit-chart', currentStoreId, selectedPeriod, accessibleStoreIds],
    enabled: !isStoresLoading,
    queryFn: async () => {
      const storeIds = currentStoreId ? [currentStoreId] : accessibleStoreIds

      if (storeIds.length === 0) {
        return { points: [], totalProfit: 0 }
      }

      const results = await Promise.all(
        storeIds.map(async (storeId) => {
          const { data: rows, error } = await supabase.rpc('rpc_dashboard_profit_chart', {
            p_store_id: storeId,
            p_start_date: periodRange.start ? periodRange.start.toISOString() : null,
            p_end_date: periodRange.end ? periodRange.end.toISOString() : null,
          })
          if (error) throw error
          return (rows || []) as Array<{ date_key: string; profit: number }>
        })
      )

      // Aggregate by date_key
      const profitMap = new Map<string, number>()
      for (const rows of results) {
        for (const row of rows) {
          const key = String(row.date_key)
          profitMap.set(key, (profitMap.get(key) || 0) + Number(row.profit || 0))
        }
      }

      const sortedKeys = Array.from(profitMap.keys()).sort()
      const points = sortedKeys.map((date_key) => {
        const date = new Date(date_key)
        return {
          label: date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
          profit: profitMap.get(date_key)!,
        }
      })
      const sliced = points.length > 12 ? points.slice(points.length - 12) : points
      const totalProfit = sliced.reduce((sum: number, p: { label: string; profit: number }) => sum + p.profit, 0)

      return { points: sliced, totalProfit }
    },
  })


  const points = data?.points || []
  const maxAbs = points.length > 0 ? Math.max(...points.map((p: { label: string; profit: number }) => Math.abs(p.profit)), 1) : 1

  return (
    <div className="bg-card rounded-xl shadow p-4 sm:p-6">

      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Évolution du profit</h3>
          <p className="text-sm text-muted-foreground mt-1">Selon la période sélectionnée</p>
        </div>
        <div className={`flex items-center ${(data?.totalProfit || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {(data?.totalProfit || 0) >= 0 ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
          <span className="text-sm font-medium">{formatCurrency(data?.totalProfit || 0)}</span>
        </div>
      </div>

      {isLoading ? (
        <div className="h-64 flex items-center justify-center text-muted-foreground">Chargement...</div>
      ) : points.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-muted-foreground">Pas de données pour cette période</div>
      ) : (
        <div className="h-64 flex items-end justify-between gap-2 pt-4">
          {points.map((point: { label: string; profit: number }, index: number) => {
            const height = (Math.abs(point.profit) / maxAbs) * 100
            return (
              <div key={index} className="flex flex-col items-center flex-1 min-w-0">
                <div className="text-xs text-muted-foreground mb-2 truncate">{point.label}</div>
                <div
                  className={`w-5 rounded-t ${point.profit >= 0 ? 'bg-gradient-to-t from-emerald-500 to-emerald-400' : 'bg-gradient-to-t from-red-500 to-red-400'}`}
                  style={{ height: `${Math.max(height, 2)}%` }}
                  title={formatCurrency(point.profit)}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
