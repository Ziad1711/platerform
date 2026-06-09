'use client'

import { useMemo, useState } from 'react'
import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'
import { formatCurrency, getPeriodRange } from '@/lib/utils'

type SortBy = 'revenue' | 'confirmationRate' | 'returnRate'

export default function CityPerformance() {
  const { currentStoreId, selectedPeriod, customStartDate, customEndDate, accessibleStoreIds, isStoresLoading } = useStore()
  const periodRange = getPeriodRange(selectedPeriod, { customStartDate, customEndDate })
  const supabase = createClient()
  const [sortBy, setSortBy] = useState<SortBy>('revenue')

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-city-performance', currentStoreId, selectedPeriod, customStartDate, customEndDate, accessibleStoreIds],
    enabled: !isStoresLoading,
    queryFn: async () => {
      const storeIds = currentStoreId ? [currentStoreId] : accessibleStoreIds

      if (storeIds.length === 0) {
        return []
      }

      const results = await Promise.all(
        storeIds.map(async (storeId) => {
          const { data, error } = await supabase.rpc('rpc_dashboard_city_performance', {
            p_store_ids: [storeId],
            p_start_date: periodRange.start ? periodRange.start.toISOString() : null,
            p_end_date: periodRange.end ? periodRange.end.toISOString() : null,
          })
          if (error) throw error
          return (data || []) as Array<{
            city: string
            total_orders: number
            confirmed_orders: number
            delivered_orders: number
            returned_orders: number
            cancelled_orders: number
            total_revenue: number
          }>
        })
      )

      // Aggregate by city
      const cityMap = new Map<string, {
        city: string
        orders: number
        confirmed: number
        returned: number
        delivered: number
        revenue: number
      }>()

      for (const rows of results) {
        for (const row of rows) {
          const city = String(row.city || 'Non renseignée')
          const existing = cityMap.get(city) || {
            city,
            orders: 0,
            confirmed: 0,
            returned: 0,
            delivered: 0,
            revenue: 0,
          }
          existing.orders += Number(row.total_orders || 0)
          existing.confirmed += Number(row.confirmed_orders || 0)
          existing.returned += Number(row.returned_orders || 0)
          existing.delivered += Number(row.delivered_orders || 0)
          existing.revenue += Number(row.total_revenue || 0)
          cityMap.set(city, existing)
        }
      }

      return Array.from(cityMap.values()).map((row) => ({
        ...row,
        confirmationRate: row.orders > 0 ? (row.confirmed / row.orders) * 100 : 0,
        returnRate: row.orders > 0 ? (row.returned / row.orders) * 100 : 0,
      }))
    },
  })


  const sortedCities = useMemo(() => {
    const rows = [...(data || [])]
    return rows.sort((a, b) => (b[sortBy] as number) - (a[sortBy] as number))
  }, [data, sortBy])

  const sortLabel =
    sortBy === 'revenue'
      ? "Chiffre d'affaires"
      : sortBy === 'confirmationRate'
      ? 'Taux de confirmation'
      : 'Taux de retour'

  const topCities = useMemo(() => sortedCities.slice(0, 5), [sortedCities])

  return (
    <div className="bg-card rounded-xl shadow">
      <div className="p-6 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Performance par ville</h3>
          <p className="text-xs text-muted-foreground mt-1">Tri par chiffre d'affaires par défaut</p>
        </div>
        <select
          className="border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary bg-card text-foreground"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
        >
          <option value="revenue">Chiffre d'affaires</option>
          <option value="confirmationRate">Taux de confirmation</option>
          <option value="returnRate">Taux de retour</option>
        </select>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Chargement...</div>
      ) : topCities.length > 0 ? (
        <div className="p-4 md:p-6 space-y-2">
          <div className="text-xs text-muted-foreground mb-2">Top 5 — {sortLabel}</div>
          {topCities.map((row, index) => {
            const score = Number(row[sortBy] || 0)
            return (
              <div key={row.city} className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                <div className="text-sm font-medium text-foreground">#{index + 1} {row.city}</div>
                <div className="text-sm font-semibold text-foreground">
                  {sortBy === 'revenue'
                    ? formatCurrency(score)
                    : `${score.toFixed(1)}%`}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="p-8 text-center text-muted-foreground">Aucune donnée de ville pour cette période</div>
      )}
    </div>
  )
}
