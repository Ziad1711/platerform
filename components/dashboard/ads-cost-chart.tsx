'use client'

import { useMemo, useState } from 'react'
import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'
import { getPeriodRange } from '@/lib/utils'

function startOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function formatAxisValue(value: number) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return value.toFixed(0)
}

export default function AdsCostChart() {
  const { currentStoreId, selectedPeriod, customStartDate, customEndDate, accessibleStoreIds } = useStore()
  const supabase = createClient()
  const periodRange = getPeriodRange(selectedPeriod, { customStartDate, customEndDate })
  const [showCpl, setShowCpl] = useState(true)
  const [showCpa, setShowCpa] = useState(true)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-ads-cost-chart', currentStoreId, selectedPeriod, customStartDate, customEndDate],
    queryFn: async () => {
      const now = new Date()
      const todayStart = startOfDay(now)

      let periodStart = periodRange.start ? startOfDay(periodRange.start) : startOfDay(addDays(now, -29))
      let periodEndExclusive = periodRange.end ? startOfDay(periodRange.end) : addDays(todayStart, 1)

      if (selectedPeriod === 'today') {
        const ref = todayStart
        periodStart = addDays(ref, -6)
        periodEndExclusive = addDays(ref, 1)
      } else if (selectedPeriod === 'yesterday') {
        const ref = addDays(todayStart, -1)
        periodStart = addDays(ref, -6)
        periodEndExclusive = addDays(ref, 1)
      } else if (selectedPeriod === 'week') {
        const weekStart = startOfDay(new Date(now))
        const day = weekStart.getDay()
        const diff = day === 0 ? 6 : day - 1
        weekStart.setDate(weekStart.getDate() - diff)
        periodStart = weekStart
        periodEndExclusive = addDays(weekStart, 7)
      } else if (selectedPeriod === 'month') {
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
        periodEndExclusive = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      }

      const todayEndExclusive = addDays(todayStart, 1)
      if (periodEndExclusive > todayEndExclusive) {
        periodEndExclusive = todayEndExclusive
      }

      const dayCount = Math.max(1, Math.round((periodEndExclusive.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)))
      const useMonthly = selectedPeriod !== 'month' && selectedPeriod !== 'today' && selectedPeriod !== 'yesterday' && selectedPeriod !== 'week' && dayCount > 31
      const granularity: 'day' | 'month' = useMonthly ? 'month' : 'day'

      const bucketLabel = (d: Date) =>
        granularity === 'day'
          ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
          : d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })

      const storeIds = currentStoreId ? [currentStoreId] : accessibleStoreIds

      if (storeIds.length === 0) {
        return { points: [] }
      }

      const results = await Promise.all(
        storeIds.map(async (storeId) => {
          const { data: rows, error } = await supabase.rpc('rpc_dashboard_ads_cost_chart', {
            p_store_id: storeId,
            p_start_date: periodStart.toISOString(),
            p_end_date: periodEndExclusive.toISOString(),
            p_granularity: granularity,
          })
          if (error) throw error
          return (rows || []) as Array<{ date: string; ads: number; orders_count: number; delivered_count: number }>
        })
      )

      // Aggregate points by date
      const pointsMap = new Map<string, { ads: number; orders_count: number; delivered_count: number }>()

      for (const rows of results) {
        for (const row of rows) {
          const existing = pointsMap.get(String(row.date)) || { ads: 0, orders_count: 0, delivered_count: 0 }
          existing.ads += Number(row.ads || 0)
          existing.orders_count += Number(row.orders_count || 0)
          existing.delivered_count += Number(row.delivered_count || 0)
          pointsMap.set(String(row.date), existing)
        }
      }

      const sortedDates = Array.from(pointsMap.keys()).sort()
      const points = sortedDates.map((date) => {
        const d = new Date(date)
        const p = pointsMap.get(date)!
        return {
          date,
          label: bucketLabel(d),
          cpl: p.orders_count > 0 ? p.ads / p.orders_count : 0,
          cpa: p.delivered_count > 0 ? p.ads / p.delivered_count : 0,
        }
      })

      return { points }
    },
  })


  const points = data?.points || []
  const maxY = useMemo(() => {
    if (points.length === 0) return 1
    return Math.max(...points.flatMap((p: { cpl: number; cpa: number }) => [p.cpl, p.cpa]).map((v: number) => Math.abs(v)), 1)
  }, [points])
  const yTicks = [maxY, maxY * 0.75, maxY * 0.5, maxY * 0.25, 0]

  const labelStep = points.length > 0 ? Math.max(1, Math.ceil(points.length / 8)) : 1
  const labelTicks = points.filter((_: { date: string; label: string; cpl: number; cpa: number }, index: number) => index % labelStep === 0 || index === points.length - 1)

  const buildPath = (key: 'cpl' | 'cpa') => {
    if (points.length === 0) return ''
    return points
      .map((point: { cpl: number; cpa: number }, index: number) => {
        const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100
        const raw = key === 'cpl' ? point.cpl : point.cpa
        const y = 95 - (raw / maxY) * 90
        return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
      })
      .join(' ')
  }

  return (
    <div className="bg-card rounded-xl shadow p-6 overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-foreground">Coûts Ads moyens (CPL / CPA)</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCpl((v) => !v)}
            className={`px-2 py-1 text-xs rounded border ${showCpl ? 'bg-blue-100 dark:bg-blue-900 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300' : 'text-muted-foreground border-border'}`}
          >
            CPL
          </button>
          <button
            onClick={() => setShowCpa((v) => !v)}
            className={`px-2 py-1 text-xs rounded border ${showCpa ? 'bg-green-100 dark:bg-green-900 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300' : 'text-muted-foreground border-border'}`}
          >
            CPA
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="h-56 flex items-center justify-center text-muted-foreground">Chargement...</div>
      ) : points.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-muted-foreground">Pas de données pour cette période</div>
      ) : (
        <>
          <div className="h-56 w-full border border-border rounded-lg p-3 bg-card overflow-hidden">
            <div className="relative w-full h-full pl-10">
              <div className="absolute left-0 top-0 bottom-0 w-9 flex flex-col justify-between text-[10px] text-muted-foreground">
                {yTicks.map((tick, idx) => (
                  <span key={idx}>{formatAxisValue(tick)}</span>
                ))}
              </div>

              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
                {[85, 70, 55, 40, 25, 10].map((y) => (
                  <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="var(--border)" strokeWidth="0.4" />
                ))}

                {showCpl && <path d={buildPath('cpl')} fill="none" stroke="#2563eb" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />}
                {showCpa && <path d={buildPath('cpa')} fill="none" stroke="#16a34a" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />}

                {hoveredIndex !== null && points[hoveredIndex] && (
                  <line
                    x1={points.length === 1 ? 0 : (hoveredIndex / (points.length - 1)) * 100}
                    x2={points.length === 1 ? 0 : (hoveredIndex / (points.length - 1)) * 100}
                    y1="0"
                    y2="100"
                    stroke="var(--muted-foreground)"
                    strokeDasharray="2 2"
                    strokeWidth="0.5"
                  />
                )}
              </svg>

              {points.length > 1 && (
                <div className="absolute inset-0 flex">
                  {points.map((_: { date: string; label: string; cpl: number; cpa: number }, index: number) => (
                    <div
                      key={index}
                      className="flex-1 h-full"
                      onMouseEnter={() => setHoveredIndex(index)}
                      onMouseLeave={() => setHoveredIndex(null)}
                    />
                  ))}
                </div>
              )}

              {hoveredIndex !== null && points[hoveredIndex] && (
                <div
                  className="absolute top-2 z-20 bg-popover text-popover-foreground text-xs rounded px-3 py-2 shadow-lg pointer-events-none border border-border"
                  style={{
                    left: `${points.length === 1 ? 0 : (hoveredIndex / (points.length - 1)) * 100}%`,
                    transform: 'translateX(-50%)',
                  }}
                >
                  <div className="font-semibold mb-1">{points[hoveredIndex].label}</div>
                  <div>CPL: {points[hoveredIndex].cpl.toFixed(2)} MAD</div>
                  <div>CPA: {points[hoveredIndex].cpa.toFixed(2)} MAD</div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-2 flex justify-between text-xs text-muted-foreground gap-2">
            {labelTicks.map((p: { date: string; label: string }, i: number) => (
              <span key={`${p.date}-${i}`} className="text-center">{p.label}</span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
