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

function formatShortCurrency(value: number) {
  const abs = Math.abs(value)
  if (abs >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (abs >= 1000) return `${(value / 1000).toFixed(1)}k`
  return Math.round(value).toString()
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

  const valueToY = (value: number) => {
    if (maxY === 0) return 50
    return 95 - (value / maxY) * 90
  }

  const buildPath = (key: 'cpl' | 'cpa') => {
    if (points.length === 0) return ''
    return points
      .map((point: { cpl: number; cpa: number }, index: number) => {
        const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100
        const raw = key === 'cpl' ? point.cpl : point.cpa
        const y = valueToY(raw)
        return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
      })
      .join(' ')
  }

  const seriesConfig = {
    cpl: { label: 'CPL', color: '#2563eb' },
    cpa: { label: 'CPA', color: '#16a34a' },
  }

  // ── Premium chart extras ──

  const pointToX = (index: number) => {
    if (points.length <= 1) return 50
    return (index / (points.length - 1)) * 100
  }

  const isCollision = (x1: number, x2: number, threshold = 18) => {
    return Math.abs(x1 - x2) < threshold
  }

  // Find max CPL and max CPA points
  const maxCplPoint = useMemo(() => {
    if (!points || points.length < 2) return null
    let maxIdx = 0
    let maxVal = -Infinity
    points.forEach((p: { cpl: number }, i: number) => {
      if (p.cpl > maxVal) {
        maxVal = p.cpl
        maxIdx = i
      }
    })
    if (maxVal <= 0 || !isFinite(maxVal)) return null
    return { index: maxIdx, value: maxVal }
  }, [points])

  const maxCpaPoint = useMemo(() => {
    if (!points || points.length < 2) return null
    let maxIdx = 0
    let maxVal = -Infinity
    points.forEach((p: { cpa: number }, i: number) => {
      if (p.cpa > maxVal) {
        maxVal = p.cpa
        maxIdx = i
      }
    })
    if (maxVal <= 0 || !isFinite(maxVal)) return null
    return { index: maxIdx, value: maxVal }
  }, [points])

  // Badge positions with collision avoidance
  const badgePositions = useMemo(() => {
    const positions: { key: string; x: number; y: number; value: number; label: string; color: string; offsetY: number }[] = []

    if (maxCplPoint && showCpl) {
      const x = pointToX(maxCplPoint.index)
      const y = valueToY(maxCplPoint.value)
      positions.push({
        key: 'cpl',
        x, y,
        value: maxCplPoint.value,
        label: 'Max CPL',
        color: seriesConfig.cpl.color,
        offsetY: 0,
      })
    }

    if (maxCpaPoint && showCpa) {
      const x = pointToX(maxCpaPoint.index)
      const y = valueToY(maxCpaPoint.value)
      let offsetY = 0
      if (positions.length > 0 && isCollision(x, positions[0].x, 20)) {
        offsetY = positions[0].y < y ? -8 : 8
      }
      positions.push({
        key: 'cpa',
        x, y,
        value: maxCpaPoint.value,
        label: 'Max CPA',
        color: seriesConfig.cpa.color,
        offsetY,
      })
    }

    return positions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxCplPoint, maxCpaPoint, showCpl, showCpa, points])

  // Value labels on peaks
  const valueLabels = useMemo(() => {
    const labels: { key: string; x: number; y: number; text: string; color: string }[] = []

    if (maxCplPoint && showCpl) {
      const x = pointToX(maxCplPoint.index)
      const y = valueToY(maxCplPoint.value)
      labels.push({
        key: 'cpl',
        x,
        y: y - 5,
        text: `${formatShortCurrency(maxCplPoint.value)} MAD`,
        color: seriesConfig.cpl.color,
      })
    }

    if (maxCpaPoint && showCpa) {
      const x = pointToX(maxCpaPoint.index)
      const y = valueToY(maxCpaPoint.value)
      let labelY = y - 5
      if (labels.length > 0 && isCollision(x, labels[0].x, 22)) {
        labelY = labels[0].y < y ? y - 12 : y + 2
      }
      labels.push({
        key: 'cpa',
        x,
        y: labelY,
        text: `${formatShortCurrency(maxCpaPoint.value)} MAD`,
        color: seriesConfig.cpa.color,
      })
    }

    return labels
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxCplPoint, maxCpaPoint, showCpl, showCpa, points])

  return (
    <div className="bg-card rounded-xl shadow p-6 overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-foreground">Coûts Ads moyens (CPL / CPA)</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCpl((v) => !v)}
            className={`px-2 py-1 text-xs rounded border transition-colors ${
              showCpl ? 'bg-secondary border-border text-foreground' : 'bg-card border-border text-muted-foreground'
            }`}
          >
            <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: seriesConfig.cpl.color }} />
            CPL
          </button>
          <button
            onClick={() => setShowCpa((v) => !v)}
            className={`px-2 py-1 text-xs rounded border transition-colors ${
              showCpa ? 'bg-secondary border-border text-foreground' : 'bg-card border-border text-muted-foreground'
            }`}
          >
            <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: seriesConfig.cpa.color }} />
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
                {yTicks.map((tick: number, idx: number) => (
                  <span key={idx}>{formatAxisValue(tick)}</span>
                ))}
              </div>

              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
                {yTicks.map((tick: number, idx: number) => (
                  <line
                    key={idx}
                    x1="0"
                    y1={valueToY(tick)}
                    x2="100"
                    y2={valueToY(tick)}
                    stroke="var(--border)"
                    strokeWidth="0.4"
                  />
                ))}

                {showCpl && (
                  <path d={buildPath('cpl')} fill="none" stroke={seriesConfig.cpl.color} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
                )}
                {showCpa && (
                  <path d={buildPath('cpa')} fill="none" stroke={seriesConfig.cpa.color} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
                )}

                {/* ── Max point dots ── */}
                {maxCplPoint && showCpl && (
                  <circle
                    cx={pointToX(maxCplPoint.index)}
                    cy={valueToY(maxCplPoint.value)}
                    r="1"
                    fill={seriesConfig.cpl.color}
                    opacity="0.7"
                  />
                )}
                {maxCpaPoint && showCpa && (
                  <circle
                    cx={pointToX(maxCpaPoint.index)}
                    cy={valueToY(maxCpaPoint.value)}
                    r="1"
                    fill={seriesConfig.cpa.color}
                    opacity="0.7"
                  />
                )}

                {/* ── Value labels on peaks ── */}
                {valueLabels.map((vl) => (
                  <text
                    key={vl.key}
                    x={vl.x}
                    y={vl.y}
                    fill={vl.color}
                    opacity="0.45"
                    fontSize="2.4"
                    fontWeight="400"
                    textAnchor="middle"
                    fontFamily="inherit"
                    letterSpacing="0.3"
                  >
                    {vl.text}
                  </text>
                ))}

                {/* ── Badges (Max CPL / Max CPA) ── */}
                {badgePositions.map((bp) => (
                  <g key={bp.key}>
                    <rect
                      x={bp.x - 6}
                      y={bp.y - 3 + bp.offsetY}
                      width="12"
                      height="3.5"
                      rx="0.8"
                      fill={bp.color}
                      opacity="0.06"
                    />
                    <rect
                      x={bp.x - 6}
                      y={bp.y - 3 + bp.offsetY}
                      width="12"
                      height="3.5"
                      rx="0.8"
                      fill="none"
                      stroke={bp.color}
                      strokeWidth="0.2"
                      opacity="0.15"
                    />
                    <text
                      x={bp.x}
                      y={bp.y - 0.4 + bp.offsetY}
                      fill={bp.color}
                      opacity="0.55"
                      fontSize="1.9"
                      fontWeight="400"
                      textAnchor="middle"
                      fontFamily="inherit"
                      letterSpacing="0.2"
                    >
                      {bp.label} • {formatShortCurrency(bp.value)} MAD
                    </text>
                  </g>
                ))}

                {/* ── Vertical line (default last point, hover override) ── */}
                {(hoveredIndex !== null ? hoveredIndex : points.length - 1) >= 0 && (
                  <line
                    x1={points.length === 1 ? 0 : (((hoveredIndex !== null ? hoveredIndex : points.length - 1)) / (points.length - 1)) * 100}
                    x2={points.length === 1 ? 0 : (((hoveredIndex !== null ? hoveredIndex : points.length - 1)) / (points.length - 1)) * 100}
                    y1="4"
                    y2="96"
                    stroke="currentColor"
                    className="text-foreground/40 dark:text-white/30"
                    strokeDasharray="2 4"
                    strokeWidth="0.8"
                    opacity={hoveredIndex !== null ? "0.25" : "0.18"}
                  />
                )}
              </svg>

              <div
                className="absolute inset-0 z-10"
                onPointerMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const x = e.clientX - rect.left
                  const pct = x / rect.width
                  const idx = Math.round(pct * (points.length - 1))
                  setHoveredIndex(Math.max(0, Math.min(points.length - 1, idx)))
                }}
                onPointerLeave={() => setHoveredIndex(null)}
              />

              {hoveredIndex !== null && points[hoveredIndex] && (
                <div
                  className="absolute z-20 pointer-events-none backdrop-blur-sm"
                  style={{
                    top: '8px',
                    ...(hoveredIndex / (points.length - 1) < 0.5
                      ? { right: `${100 - (points.length === 1 ? 0 : (hoveredIndex / (points.length - 1)) * 100)}%`, transform: 'translateX(-8px)' }
                      : { left: `${(points.length === 1 ? 0 : (hoveredIndex / (points.length - 1)) * 100)}%`, transform: 'translateX(8px)' }
                    ),
                  }}
                >
                  <div className="bg-background/80 dark:bg-background/70 border border-border/60 rounded-lg px-3.5 py-2.5 shadow-xl min-w-[140px]">
                    <div className="text-[11px] font-semibold text-foreground/80 mb-2 tracking-wide uppercase">
                      {points[hoveredIndex].label}
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: seriesConfig.cpl.color }} />
                          <span className="text-[11px] text-muted-foreground">CPL</span>
                        </div>
                        <span className="text-[11px] font-medium text-foreground/90 tabular-nums">{points[hoveredIndex].cpl.toFixed(2)} MAD</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: seriesConfig.cpa.color }} />
                          <span className="text-[11px] text-muted-foreground">CPA</span>
                        </div>
                        <span className="text-[11px] font-medium text-foreground/90 tabular-nums">{points[hoveredIndex].cpa.toFixed(2)} MAD</span>
                      </div>
                    </div>
                  </div>
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
