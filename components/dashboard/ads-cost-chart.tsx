'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'
import { buildRoundedPath, getPeriodRange } from '@/lib/utils'

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

// Position horizontale de l'infobulle : à côté du trait, mais toujours dans le cadre
// du graphique (bascule de côté quand on arrive sur les extrémités).
function getTooltipLeft(
  hoveredIndex: number | null,
  pointsCount: number,
  plot: SVGSVGElement | null,
  tooltipWidth: number
): string | null {
  if (hoveredIndex === null || pointsCount === 0 || !plot) return null

  const container = plot.parentElement
  if (!container) return null
  const containerWidth = container.clientWidth
  if (containerWidth === 0) return null

  const plotRect = plot.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  const plotLeft = plotRect.left - containerRect.left
  const plotWidth = plotRect.width

  const pct = pointsCount === 1 ? 0 : hoveredIndex / (pointsCount - 1)
  const gap = 8
  const lineX = plotLeft + pct * plotWidth

  let left = pct < 0.5 ? lineX - gap - tooltipWidth : lineX + gap
  if (left < 0) left = lineX + gap
  if (left + tooltipWidth > containerWidth) left = Math.max(0, lineX - gap - tooltipWidth)

  return `${left}px`
}

export default function AdsCostChart() {
  const { currentStoreId, selectedPeriod, customStartDate, customEndDate, accessibleStoreIds, isStoresLoading } = useStore()
  const supabase = createClient()
  const periodRange = getPeriodRange(selectedPeriod, { customStartDate, customEndDate })
  const [showCpl, setShowCpl] = useState(true)
  const [showCpa, setShowCpa] = useState(true)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const plotRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [tooltipWidth, setTooltipWidth] = useState(170)

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-ads-cost-chart', currentStoreId, selectedPeriod, customStartDate, customEndDate, accessibleStoreIds],
    enabled: !isStoresLoading,
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

      // « Toujours » : le RPC renvoie tous les buckets depuis la borne basse (mois vides
      // inclus). On ne conserve que les périodes avec une activité réelle.
      if (selectedPeriod === 'all') {
        for (const [date, value] of Array.from(pointsMap.entries())) {
          if (value.ads === 0 && value.orders_count === 0 && value.delivered_count === 0) {
            pointsMap.delete(date)
          }
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

  // Largeur réelle de l'infobulle (mesurée après affichage).
  useEffect(() => {
    if (hoveredIndex !== null && tooltipRef.current) {
      setTooltipWidth(tooltipRef.current.offsetWidth)
    }
  }, [hoveredIndex, points.length])

  const tooltipLeft = getTooltipLeft(hoveredIndex, points.length, plotRef.current, tooltipWidth)

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
    const coordinates = points.map((point: { cpl: number; cpa: number }, index: number) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100
      const raw = key === 'cpl' ? point.cpl : point.cpa
      return { x, y: valueToY(raw) }
    })
    return buildRoundedPath(coordinates, 1)
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

  return (
    <div className="bg-card rounded-xl shadow p-4 sm:p-6 overflow-hidden">

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
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

              <svg ref={plotRef} viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
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
                  <path d={buildPath('cpl')} fill="none" stroke={seriesConfig.cpl.color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                )}
                {showCpa && (
                  <path d={buildPath('cpa')} fill="none" stroke={seriesConfig.cpa.color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                )}

                {/* Les points des sommets et leurs labels sont rendus en HTML
                    hors du SVG pour éviter l'étirement horizontal
                    (preserveAspectRatio="none"). */}

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
                    strokeWidth={hoveredIndex !== null ? '0.4' : '0.8'}
                    opacity={hoveredIndex !== null ? '0.6' : '0.18'}
                  />
                )}
              </svg>

              {/* ── Sommets (labels + badges) rendus en HTML pour rester nets
                  malgré l'étirement horizontal du SVG ── */}
              <div className="pointer-events-none absolute inset-y-0 right-0 left-10 z-[5]">
                {maxCplPoint && showCpl && (
                  <span
                    className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-70"
                    style={{
                      left: `${pointToX(maxCplPoint.index)}%`,
                      top: `${valueToY(maxCplPoint.value)}%`,
                      backgroundColor: seriesConfig.cpl.color,
                    }}
                  />
                )}
                {maxCpaPoint && showCpa && (
                  <span
                    className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-70"
                    style={{
                      left: `${pointToX(maxCpaPoint.index)}%`,
                      top: `${valueToY(maxCpaPoint.value)}%`,
                      backgroundColor: seriesConfig.cpa.color,
                    }}
                  />
                )}

                {badgePositions.map((bp) => (
                  <span
                    key={`badge-${bp.key}`}
                    className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
                    style={{
                      left: `${bp.x}%`,
                      top: `${bp.y + bp.offsetY}%`,
                      color: bp.color,
                      borderColor: `${bp.color}33`,
                      backgroundColor: `${bp.color}14`,
                    }}
                  >
                    {bp.label} • {formatShortCurrency(bp.value)} MAD
                  </span>
                ))}
              </div>

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
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const x = e.clientX - rect.left
                  const pct = x / rect.width
                  const idx = Math.round(pct * (points.length - 1))
                  setHoveredIndex(Math.max(0, Math.min(points.length - 1, idx)))
                }}
              />

              {hoveredIndex !== null && points[hoveredIndex] && (
                <div
                  ref={tooltipRef}
                  className="absolute z-20 pointer-events-none backdrop-blur-sm"
                  style={{ top: '8px', left: tooltipLeft || undefined }}
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
