'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'
import { DASHBOARD_ANALYTICS_STALE_MS } from '@/lib/dashboard/analytics-cache'
import { buildRoundedPath } from '@/lib/utils'
import { businessRange, useKpiReader } from '@/lib/dashboard/use-kpi-reader'
import {
  addBusinessDays,
  businessRangeToInstants,
  formatBusinessDayLabel,
  legacyBusinessRange,
} from '@/lib/dashboard/business-time'
import { buildReaderScope } from '@/lib/dashboard/kpi-reader-mappers'
import type { KpiReaderMode } from '@/lib/dashboard/kpi-reader-flag'
import { useKpiReaderErrorTelemetry, useKpiRollout } from '@/lib/dashboard/use-kpi-rollout'


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

export default function AdsCostChart({ source }: { source?: KpiReaderMode } = {}) {
  const { currentStoreId, selectedPeriod, customStartDate, customEndDate, accessibleStoreIds, isStoresLoading, userId } = useStore()
  const rollout = useKpiRollout()
  const mode = source ?? rollout.mode
  const supabase = createClient()
  const legacyRange = legacyBusinessRange(selectedPeriod, customStartDate, customEndDate)
  const legacyQueryRange =
    selectedPeriod === 'today' || selectedPeriod === 'yesterday'
      ? { from: addBusinessDays(legacyRange.from, -6), to: legacyRange.to }
      : legacyRange
  const legacyPeriod = businessRangeToInstants(legacyQueryRange)

  const v5Enabled = mode === 'v5'
  const v5Range = businessRange(selectedPeriod, customStartDate, customEndDate)
  const v5 = useKpiReader({
    enabled: v5Enabled && !isStoresLoading,
    supabase,
    boundary: `${userId ?? 'anonymous'}:${rollout.accessFingerprint}`,
    storeIds: currentStoreId ? [currentStoreId] : null,
    from: v5Range.from,
    to: v5Range.to,
    pollMs: 0,
  })
  const v5Scope = useMemo(() => (v5.data ? buildReaderScope(v5.data) : null), [v5.data])
  useKpiReaderErrorTelemetry('ads-cost-chart', v5Enabled, v5.isError)
  const v5Data = useMemo(() => {
    if (!v5Enabled || !v5Scope) return undefined
    return {
      points: v5Scope.points.map((point) => ({
        date: point.date,
        label: formatBusinessDayLabel(point.date, 'day'),
        cpl: point.orders_count > 0 ? Number(point.ads) / point.orders_count : 0,
        cpa: point.delivered_count > 0 ? Number(point.ads) / point.delivered_count : 0,
      })),
    }
  }, [v5Enabled, v5Scope])

  const [showCpl, setShowCpl] = useState(true)
  const [showCpa, setShowCpa] = useState(true)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const plotRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [tooltipWidth, setTooltipWidth] = useState(170)
  const [containerWidth, setContainerWidth] = useState(800)

  const { data: legacyData, isLoading: legacyLoading } = useQuery({
    queryKey: ['dashboard-ads-cost-chart', currentStoreId, selectedPeriod, customStartDate, customEndDate, accessibleStoreIds, mode, rollout.accessFingerprint],
    enabled: !isStoresLoading && mode !== 'v5' && rollout.resolved,
    staleTime: DASHBOARD_ANALYTICS_STALE_MS,
    queryFn: async () => {
      const periodStart = legacyPeriod.start
      const periodEndExclusive = legacyPeriod.end
      const dayCount = Math.max(1, Math.round((periodEndExclusive.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)))
      const useMonthly = selectedPeriod !== 'month' && selectedPeriod !== 'today' && selectedPeriod !== 'yesterday' && selectedPeriod !== 'week' && dayCount > 31
      const granularity: 'day' | 'month' = useMonthly ? 'month' : 'day'

      const bucketLabel = (d: Date) =>
        formatBusinessDayLabel(
          `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
          granularity,
        )

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


  const data = v5Enabled ? v5Data : legacyData
  const isLoading = v5Enabled
    ? isStoresLoading || v5.isLoading
    : isStoresLoading || legacyLoading || !rollout.resolved
  const v5Failed = v5Enabled && !v5.isLoading && v5.isError
  const v5NoData = v5Enabled && !isLoading && !v5Failed && (!v5Scope || v5Scope.mixed)
  const points = data?.points || []

  // Mesure de la largeur réelle du plot pour adapter le nombre de labels X.
  useEffect(() => {
    const el = plotRef.current
    if (!el) return
    setContainerWidth(el.clientWidth)
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect?.width
      if (cw) setContainerWidth(cw)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [points.length])

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

  const labelStep = useMemo(() => {
    if (points.length === 0) return 1
    const base = containerWidth >= 1024 ? 14 : containerWidth >= 768 ? 10 : 8
    return Math.max(1, Math.ceil(points.length / base))
  }, [points.length, containerWidth])
  const labelTicks = points
    .map((p: { date: string; label: string; cpl: number; cpa: number }, index: number) => ({ ...p, index }))
    .filter((p: { index: number }) => p.index % labelStep === 0 || p.index === points.length - 1)

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

  return (
    <div className="bg-card rounded-xl shadow p-4 sm:p-6 overflow-hidden">

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">Coûts Ads moyens (CPL / CPA)</h3>
          {v5Enabled && v5Scope?.incomplete && (
            <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">
              Données partielles : les journées non couvertes sont exclues du graphique.
            </p>
          )}
        </div>
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
      ) : v5Failed || v5NoData ? (
        <div className="h-56 flex items-center justify-center px-6 text-center text-muted-foreground">
          {v5Scope?.mixed
            ? 'Plusieurs devises ou niveaux d’accès : les coûts ne sont pas additionnés. Sélectionnez une boutique.'
            : v5Failed
              ? 'KPI indisponibles : la lecture V5 a échoué.'
              : 'KPI indisponibles : aucune donnée exploitable pour cette période.'}
        </div>
      ) : points.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-muted-foreground">Pas de données pour cette période</div>
      ) : (
        <>
          <div className="h-56 w-full border border-border rounded-lg p-3 bg-card overflow-hidden">
            <div className="relative w-full h-full pl-10">
              <div className="absolute left-0 top-0 bottom-0 w-9 text-[10px] text-muted-foreground">
                <div className="relative w-full h-full">
                  {yTicks.map((tick: number, idx: number) => (
                    <span key={idx} className="absolute left-0" style={{ top: `${valueToY(tick)}%`, transform: 'translateY(-50%)' }}>
                      {formatAxisValue(tick)}
                    </span>
                  ))}
                  {showCpl && maxCplPoint && (
                    <span
                      className="absolute right-0 translate-x-1 text-[11px] font-bold tabular-nums"
                      style={{ top: `${valueToY(maxCplPoint.value)}%`, transform: 'translateY(-50%)', color: seriesConfig.cpl.color }}
                    >
                      {formatShortCurrency(maxCplPoint.value)}
                    </span>
                  )}
                  {showCpa && maxCpaPoint && (
                    <span
                      className="absolute right-0 translate-x-1 text-[11px] font-bold tabular-nums"
                      style={{ top: `${valueToY(maxCpaPoint.value)}%`, transform: 'translateY(-50%)', color: seriesConfig.cpa.color }}
                    >
                      {formatShortCurrency(maxCpaPoint.value)}
                    </span>
                  )}
                </div>
              </div>

              <svg ref={plotRef} viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
                {showCpl && (
                  <path d={buildPath('cpl')} fill="none" stroke={seriesConfig.cpl.color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                )}
                {showCpa && (
                  <path d={buildPath('cpa')} fill="none" stroke={seriesConfig.cpa.color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                )}

                {/* Les points des sommets et leurs labels sont rendus en HTML
                    hors du SVG pour éviter l'étirement horizontal
                    (preserveAspectRatio="none"). */}

                {/* Lignes de sommet discrètes */}
                {showCpl && maxCplPoint && (
                  <line
                    x1="0"
                    y1={valueToY(maxCplPoint.value)}
                    x2={(maxCplPoint.index / (points.length - 1)) * 100}
                    y2={valueToY(maxCplPoint.value)}
                    stroke={seriesConfig.cpl.color}
                    strokeWidth="1"
                    opacity="0.5"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {showCpa && maxCpaPoint && (
                  <line
                    x1="0"
                    y1={valueToY(maxCpaPoint.value)}
                    x2={(maxCpaPoint.index / (points.length - 1)) * 100}
                    y2={valueToY(maxCpaPoint.value)}
                    stroke={seriesConfig.cpa.color}
                    strokeWidth="1"
                    opacity="0.5"
                    vectorEffect="non-scaling-stroke"
                  />
                )}

                {points.map((_, i) => (
                  <line
                    key={`v-${i}`}
                    x1={(points.length === 1 ? 0 : (i / (points.length - 1)) * 100)}
                    y1="0"
                    x2={(points.length === 1 ? 0 : (i / (points.length - 1)) * 100)}
                    y2="100"
                    stroke="currentColor"
                    className="text-foreground/15 dark:text-white/25"
                    strokeWidth="0.5"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
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

          <div className="relative mt-2 h-4 text-xs text-muted-foreground">
            {/* Zone alignée sur le plot : mêmes retraits que le SVG (border 1px + p-3 12px + pl-10 40px à gauche,
                border 1px + p-3 12px à droite). */}
            <div className="absolute inset-y-0 left-[53px] right-[13px]">
              {labelTicks.map((p: { date: string; label: string; index: number }) => {
                const x = points.length === 1 ? 0 : (p.index / (points.length - 1)) * 100
                return (
                  <span
                    key={`${p.date}-${p.index}`}
                    className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
                    style={{ left: `${x}%` }}
                  >
                    {p.label}
                  </span>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
