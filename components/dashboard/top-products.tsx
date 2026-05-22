'use client'

import { useMemo, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'
import { formatCurrency, getPeriodRange } from '@/lib/utils'

type SortBy = 'revenue' | 'profit'

export default function TopProducts() {
  const { currentStoreId, selectedPeriod, customStartDate, customEndDate, accessibleStoreIds } = useStore()
  const supabase = createClient()
  const periodRange = getPeriodRange(selectedPeriod, { customStartDate, customEndDate })
  const [sortBy, setSortBy] = useState<SortBy>('revenue')

  const { data: topProductsRaw, isLoading } = useQuery({
    queryKey: ['dashboard-top-products', currentStoreId, selectedPeriod, customStartDate, customEndDate],
    queryFn: async () => {
      const storeIds = currentStoreId ? [currentStoreId] : accessibleStoreIds

      if (storeIds.length === 0) {
        return []
      }

      const results = await Promise.all(
        storeIds.map(async (storeId) => {
          const { data: rows, error } = await supabase.rpc('rpc_dashboard_top_products', {
            p_store_id: storeId,
            p_start_date: periodRange.start ? periodRange.start.toISOString() : null,
            p_end_date: periodRange.end ? periodRange.end.toISOString() : null,
          })
          if (error) throw error
          return (rows || []) as Array<{ id: string; name: string; sales: number; revenue: number; profit: number }>
        })
      )

      // Aggregate products by id
      const productMap = new Map<string, { id: string; name: string; sales: number; revenue: number; profit: number }>()
      for (const rows of results) {
        for (const row of rows) {
          const id = String(row.id || 'inconnu')
          const existing = productMap.get(id) || { id, name: String(row.name || 'Produit'), sales: 0, revenue: 0, profit: 0 }
          existing.sales += Number(row.sales || 0)
          existing.revenue += Number(row.revenue || 0)
          existing.profit += Number(row.profit || 0)
          productMap.set(id, existing)
        }
      }

      return Array.from(productMap.values())
    },
  })


  const colors = ['#2563eb', '#16a34a', '#f59e0b', '#a855f7', '#ef4444']

  const topProducts = useMemo(() => {
    const rows = [...(topProductsRaw || [])]
      .sort((a, b) => (sortBy === 'revenue' ? b.revenue - a.revenue : b.profit - a.profit))
      .slice(0, 5)
    return rows
  }, [topProductsRaw, sortBy])

  const totalMetric = useMemo(() => {
    return topProducts.reduce((sum, p) => sum + Math.max(0, sortBy === 'revenue' ? p.revenue : p.profit), 0)
  }, [topProducts, sortBy])

  const conicGradient = useMemo(() => {
    if (!topProducts.length || totalMetric <= 0) {
      return 'conic-gradient(#e5e7eb 0 100%)'
    }
    let start = 0
    const stops = topProducts.map((p, index) => {
      const value = Math.max(0, sortBy === 'revenue' ? p.revenue : p.profit)
      const pct = (value / totalMetric) * 100
      const end = start + pct
      const color = colors[index % colors.length]
      const segment = `${color} ${start.toFixed(2)}% ${end.toFixed(2)}%`
      start = end
      return segment
    })
    if (start < 100) {
      stops.push(`#e5e7eb ${start.toFixed(2)}% 100%`)
    }
    return `conic-gradient(${stops.join(', ')})`
  }, [topProducts, sortBy, totalMetric])

  return (
    <div className="bg-card rounded-xl shadow">
      <div className="p-6 border-b border-border">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h3 className="text-lg font-semibold text-foreground">
            Produits les plus performants
          </h3>
          <div className="flex items-center gap-3">
            <select
              className="border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary bg-card text-foreground"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
            >
              <option value="revenue">Chiffre d'affaires</option>
              <option value="profit">Profit</option>
            </select>
            <span className="text-sm text-muted-foreground">Top 5</span>
          </div>
        </div>
      </div>

      <div className="p-6">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Chargement...</div>
        ) : topProducts && topProducts.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6 items-center">
            <div className="flex flex-col items-center">
              <div
                className="w-44 h-44 rounded-full relative"
                style={{ background: conicGradient }}
              >
                <div className="absolute inset-6 bg-card rounded-full flex items-center justify-center text-center px-2">
                  <div>
                    <div className="text-xs text-muted-foreground">
                      {sortBy === 'revenue' ? 'CA total' : 'Profit total'}
                    </div>
                    <div className="text-sm font-semibold text-foreground mt-1">
                      {formatCurrency(totalMetric)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2 min-w-0">
              {topProducts.map((product, index) => {
                const metricValue = sortBy === 'revenue' ? product.revenue : product.profit
                return (
                  <div key={product.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border px-4 py-3 overflow-hidden">
                    <div className="flex items-center gap-3 min-w-0 overflow-hidden">
                      <span
                        className="inline-block w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: colors[index % colors.length] }}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-foreground break-words whitespace-normal leading-5">{product.name}</div>
                        <div className="text-xs text-muted-foreground">{product.sales} ventes</div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`font-semibold ${sortBy === 'profit' && metricValue < 0 ? 'text-red-600' : 'text-foreground'}`}>
                        {formatCurrency(metricValue)}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center justify-end">
                        <TrendingUp className="w-3 h-3 mr-1" />
                        Top
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-muted-foreground">Pas de données produits pour cette période</div>
        )}
      </div>

    </div>
  )
}