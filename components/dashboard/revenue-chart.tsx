'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import { formatCurrency, formatNumber, buildRoundedPath } from '@/lib/utils'
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


type SeriesKey = 'revenue' | 'profit' | 'ads' | 'purchase'

/**
 * Statuts du tunnel de conversion, identiques à `rpc_dashboard_revenue_chart`
 * (migration 20261020105000) : « Confirmées » est cumulatif.
 */
const CONFIRMED_ORDER_STATUSES: string[] = [
  'confirmed',
  'picked_up',
  'sent',
  'delivered',
  'returned_not_stocked',
  'returned_stocked',
]
const SENT_ORDER_STATUSES: string[] = [
  'sent',
  'delivered',
  'returned_not_stocked',
  'returned_stocked',
]

function formatAxisValue(value: number) {
  const abs = Math.abs(value)
  if (abs >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (abs >= 1000) return `${(value / 1000).toFixed(1)}k`
  return Math.round(value).toString()
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

export default function RevenueChart({ source }: { source?: KpiReaderMode } = {}) {
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
  useKpiReaderErrorTelemetry('revenue-chart', v5Enabled, v5.isError)
  const strictPeriodStart = legacyPeriod.start
  const strictPeriodEnd = legacyPeriod.end
  const [visibleSeries, setVisibleSeries] = useState<Record<SeriesKey, boolean>>({
    revenue: true,
    profit: true,
    ads: true,
    purchase: true,
  })
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [showConversionInfo, setShowConversionInfo] = useState(false)
  const plotRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [tooltipWidth, setTooltipWidth] = useState(170)
  const [containerWidth, setContainerWidth] = useState(800)

  const { data: legacyData, isLoading: legacyLoading } = useQuery({
    queryKey: ['dashboard-business-trends', currentStoreId, selectedPeriod, customStartDate, customEndDate, accessibleStoreIds, mode, rollout.accessFingerprint],
    enabled: !isStoresLoading && mode !== 'v5' && rollout.resolved,
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
        return {
          financialAccess: false,
          points: [],
          granularity,
          totalRevenue: 0,
          totalProfit: 0,
          totalAds: 0,
          totalPurchase: 0,
          conversion: {
            totalOrders: 0,
            confirmedOrders: 0,
            cancelledOrders: 0,
            pendingOrders: 0,
            sentOrders: 0,
            deliveredOrders: 0,
            returnedOrders: 0,
            waitingPickupOrders: 0,
          },
        }
      }

      const results = await Promise.all(
        storeIds.map(async (storeId) => {
          const { data: payload, error } = await supabase.rpc('rpc_dashboard_revenue_chart', {
            p_store_id: storeId,
            p_start_date: periodStart.toISOString(),
            p_end_date: periodEndExclusive.toISOString(),
            p_granularity: granularity,
            p_conversion_start: (strictPeriodStart || periodStart).toISOString(),
            p_conversion_end: (strictPeriodEnd || periodEndExclusive).toISOString(),
          })
          if (error) throw error
          return payload
        })
      )

      // Aggregate points by date
      const pointsMap = new Map<string, { revenue: number; profit: number; ads: number; purchase: number; delivery: number }>()

      for (const payload of results) {
        const rawPoints = (payload?.points || []) as Array<{
          date: string
          revenue: number
          profit: number
          ads: number
          purchase: number
          delivery: number
        }>

        for (const p of rawPoints) {
          const existing = pointsMap.get(p.date) || { revenue: 0, profit: 0, ads: 0, purchase: 0, delivery: 0 }
          existing.revenue += Number(p.revenue || 0)
          existing.profit += Number(p.profit || 0)
          existing.ads += Number(p.ads || 0)
          existing.purchase += Number(p.purchase || 0)
          existing.delivery += Number(p.delivery || 0)
          pointsMap.set(p.date, existing)
        }
      }

      const sortedDates = Array.from(pointsMap.keys()).sort()
      const points = sortedDates.map((date) => {
        const d = new Date(date)
        const p = pointsMap.get(date)!
        return {
          date,
          label: bucketLabel(d),
          revenue: p.revenue,
          profit: p.profit,
          ads: p.ads,
          purchase: p.purchase,
          delivery: p.delivery,
        }
      })

      // Aggregate totals
      let totalRevenue = 0
      let totalProfit = 0
      let totalAds = 0
      let totalPurchase = 0
      let totalOrders = 0
      let confirmedOrders = 0
      let cancelledOrders = 0
      let pendingOrders = 0
      let sentOrders = 0
      let deliveredOrders = 0
      let returnedOrders = 0

      for (const payload of results) {
        totalRevenue += Number(payload?.totalRevenue || 0)
        totalProfit += Number(payload?.totalProfit || 0)
        totalAds += Number(payload?.totalAds || 0)
        totalPurchase += Number(payload?.totalPurchase || 0)
        const conv = (payload?.conversion || {}) as {
          total_orders?: number
          confirmed_orders?: number
          cancelled_orders?: number
          pending_orders?: number
          sent_orders?: number
          delivered_orders?: number
          returned_orders?: number
        }
        totalOrders += Number(conv.total_orders || 0)
        confirmedOrders += Number(conv.confirmed_orders || 0)
        cancelledOrders += Number(conv.cancelled_orders || 0)
        pendingOrders += Number(conv.pending_orders || 0)
        sentOrders += Number(conv.sent_orders || 0)
        deliveredOrders += Number(conv.delivered_orders || 0)
        returnedOrders += Number(conv.returned_orders || 0)
      }

      // Waiting pickup query
      let waitingPickupQuery = supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'dl_pickup_pending')
        .gte('order_date', (strictPeriodStart || periodStart).toISOString())
        .lt('order_date', (strictPeriodEnd || periodEndExclusive).toISOString())

      if (currentStoreId) {
        waitingPickupQuery = waitingPickupQuery.eq('store_id', currentStoreId)
      } else if (storeIds.length > 0) {
        waitingPickupQuery = waitingPickupQuery.in('store_id', storeIds)
      }

      const { count: waitingPickupCount, error: waitingPickupError } = await waitingPickupQuery
      if (waitingPickupError) throw waitingPickupError

      return {
        points,
        financialAccess: results.every((payload) =>
          payload?.totalProfit !== null && payload?.totalPurchase !== null,
        ),
        granularity,
        totalRevenue,
        totalProfit,
        totalAds,
        totalPurchase,
        conversion: {
          totalOrders,
          confirmedOrders,
          cancelledOrders,
          pendingOrders,
          sentOrders,
          deliveredOrders,
          returnedOrders,
          waitingPickupOrders: Number(waitingPickupCount || 0),
        },
      }
    },
  })


  // ---- V5 : source commune (lecteur agrégé), conservée derrière le flag ----
  // Compteurs du tunnel : lecture bornée et non financière, regroupée avec
  // « non ramassé ». Aucun appel à la RPC financière complète.
  const v5Counters = useQuery<{
    confirmed: number | null
    sent: number | null
    waitingPickup: number | null
  }>({
    queryKey: ['dashboard-v5-order-counters', currentStoreId, accessibleStoreIds, v5Range.from, v5Range.to, userId, rollout.accessFingerprint],
    enabled: v5Enabled && !isStoresLoading,
    queryFn: async () => {
      const storeIds = currentStoreId ? [currentStoreId] : accessibleStoreIds
      if (storeIds.length === 0) return { confirmed: 0, sent: 0, waitingPickup: 0 }
      const { start, end } = businessRangeToInstants(v5Range)
      const startIso = start.toISOString()
      const endIso = end.toISOString()

      let waitingQuery = supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'dl_pickup_pending')
        .gte('order_date', startIso)
        .lt('order_date', endIso)
      let confirmedQuery = supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .in('status', CONFIRMED_ORDER_STATUSES)
        .gte('order_date', startIso)
        .lt('order_date', endIso)
      let sentQuery = supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .in('status', SENT_ORDER_STATUSES)
        .gte('order_date', startIso)
        .lt('order_date', endIso)

      if (currentStoreId) {
        waitingQuery = waitingQuery.eq('store_id', currentStoreId)
        confirmedQuery = confirmedQuery.eq('store_id', currentStoreId)
        sentQuery = sentQuery.eq('store_id', currentStoreId)
      } else {
        waitingQuery = waitingQuery.in('store_id', storeIds)
        confirmedQuery = confirmedQuery.in('store_id', storeIds)
        sentQuery = sentQuery.in('store_id', storeIds)
      }

      const [waiting, confirmed, sent] = await Promise.all([
        waitingQuery,
        confirmedQuery,
        sentQuery,
      ])

      // Une erreur laisse `null` (indisponible) : jamais un faux zéro.
      return {
        confirmed: confirmed.error ? null : Number(confirmed.count ?? 0),
        sent: sent.error ? null : Number(sent.count ?? 0),
        waitingPickup: waiting.error ? null : Number(waiting.count ?? 0),
      }
    },
  })

  const v5Data = useMemo(() => {
    // Sans totaux (devises/accès mixtes, aucune boutique) rien n'est additionnable.
    if (!v5Enabled || !v5Scope || !v5Scope.totals) return undefined
    const totals = v5Scope.totals as unknown as Record<string, unknown>
    const n = (key: string) => Number(totals[key] ?? 0)
    return {
      financialAccess: v5Scope.access === 'full',
      points: v5Scope.points.map((point) => ({
        date: point.date,
        label: formatBusinessDayLabel(point.date, 'day'),
        revenue: Number(point.revenue),
        profit: point.contribution_margin !== undefined ? Number(point.contribution_margin) : 0,
        ads: Number(point.ads),
        purchase: point.purchase_cost !== undefined ? Number(point.purchase_cost) : 0,
        delivery: 0,
      })),
      granularity: 'day' as const,
      totalRevenue: n('revenue'),
      totalProfit: n('contribution_margin'),
      totalAds: n('ads_tracked') + n('ads_fallback'),
      totalPurchase: n('purchase_cost'),
      conversion: {
        totalOrders: n('orders_count'),
        confirmedOrders: v5Counters.data ? v5Counters.data.confirmed : null,
        cancelledOrders: n('cancelled_count'),
        pendingOrders: n('pending_count'),
        sentOrders: v5Counters.data ? v5Counters.data.sent : null,
        deliveredOrders: n('delivered_count'),
        returnedOrders: n('returned_count'),
        waitingPickupOrders: v5Counters.data ? v5Counters.data.waitingPickup : null,
      },
    }
  }, [v5Enabled, v5Scope, v5Counters.data])

  const data = v5Enabled ? v5Data : legacyData
  const isLoading = v5Enabled
    ? isStoresLoading || v5.isLoading || v5Counters.isLoading
    : isStoresLoading || legacyLoading || !rollout.resolved
  const v5Failed = v5Enabled && !v5.isLoading && v5.isError
  const v5NoTotals = v5Enabled && !isLoading && !v5Failed && !v5Scope?.totals
  const points = data?.points || []
  // Accès commercial : aucune série de coût/marge, en legacy comme en V5.
  const allowedSeries: SeriesKey[] = data?.financialAccess
    ? ['revenue', 'profit', 'ads', 'purchase']
    : ['revenue', 'ads']

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

  const activeKeys = (Object.keys(visibleSeries) as SeriesKey[]).filter(
    (k) => visibleSeries[k] && allowedSeries.includes(k),
  )
  const labelStep = useMemo(() => {
    if (points.length === 0) return 1
    const base = containerWidth >= 1024 ? 14 : containerWidth >= 768 ? 10 : 8
    return Math.max(1, Math.ceil(points.length / base))
  }, [points.length, containerWidth])
  const labelTicks = points
    .map((p, index) => ({ ...p, index }))
    .filter((p) => p.index % labelStep === 0 || p.index === points.length - 1)
  const conversion = data?.conversion
  // `null` = compteur indisponible (erreur de lecture) : jamais affiché en zéro.
  const baseOrders = conversion?.totalOrders ?? null
  const waitingPickupOrders = conversion?.waitingPickupOrders ?? null
  const conversionStages = [
    {
      key: 'total',
      label: 'Commandes',
      count: baseOrders,
      color: 'bg-slate-500',
      soft: 'bg-slate-50 text-slate-700',
    },
    {
      key: 'confirmed',
      label: 'Confirmées',
      count: conversion?.confirmedOrders ?? null,
      color: 'bg-blue-500',
      soft: 'bg-blue-50 text-blue-700',
    },
    {
      key: 'cancelled',
      label: 'Annulées',
      count: conversion?.cancelledOrders ?? null,
      color: 'bg-gray-500',
      soft: 'bg-gray-100 text-gray-700',
    },
    {
      key: 'pending',
      label: 'En traitement',
      count: conversion?.pendingOrders ?? null,
      color: 'bg-amber-500',
      soft: 'bg-amber-50 text-amber-700',
    },
    {
      key: 'waiting_pickup',
      label: 'Non ramassé',
      count: waitingPickupOrders,
      color: 'bg-cyan-500',
      soft: 'bg-cyan-50 text-cyan-700',
    },
    {
      key: 'sent',
      label: 'Expédiées',
      count: conversion?.sentOrders ?? null,
      color: 'bg-indigo-500',
      soft: 'bg-indigo-50 text-indigo-700',
    },
    {
      key: 'delivered',
      label: 'Livrées',
      count: conversion?.deliveredOrders ?? null,
      color: 'bg-emerald-500',
      soft: 'bg-emerald-50 text-emerald-700',
    },
    {
      key: 'returned',
      label: 'Retour',
      count: conversion?.returnedOrders ?? null,
      color: 'bg-rose-500',
      soft: 'bg-rose-50 text-rose-700',
    },
  ].map((stage) => {
    const unavailable = stage.count === null
    const count = stage.count ?? 0
    const base = baseOrders ?? 0
    return {
      ...stage,
      unavailable,
      rate:
        stage.key === 'total'
          ? base > 0
            ? 100
            : 0
          : base > 0
            ? (count / base) * 100
            : 0,
    }
  })

  const { yMin, yMax, yTicks } = useMemo(() => {
    if (points.length === 0) {
      return { yMin: 0, yMax: 1, yTicks: [1, 0.75, 0.5, 0.25, 0] }
    }

    const values = points.flatMap((p) =>
      activeKeys.map((k) => {
        if (k === 'revenue') return p.revenue
        if (k === 'profit') return p.profit
        if (k === 'ads') return p.ads
        return p.purchase
      })
    )

    const minVal = Math.min(...values, 0)
    const maxVal = Math.max(...values, 0)

    let min = 0
    let max = maxVal === 0 ? 1 : maxVal * 1.1

    if (minVal < 0) {
      const range = Math.max(1, maxVal - minVal)
      min = minVal - range * 0.1
      max = maxVal + range * 0.1
    }

    const ticks = Array.from({ length: 5 }, (_, i) => max - (i * (max - min)) / 4)

    return { yMin: min, yMax: max, yTicks: ticks }
  }, [points, activeKeys])

  const valueToY = (value: number) => {
    if (yMax === yMin) return 50
    return 95 - ((value - yMin) / (yMax - yMin)) * 90
  }

  const buildPath = (key: SeriesKey) => {
    if (points.length === 0) return ''
    const coordinates = points.map((point, index) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100
      const raw =
        key === 'revenue'
          ? point.revenue
          : key === 'profit'
          ? point.profit
          : key === 'ads'
          ? point.ads
          : point.purchase
      return { x, y: valueToY(raw) }
    })
    return buildRoundedPath(coordinates, 1)
  }

  const seriesConfig: Record<SeriesKey, { label: string; color: string }> = {
    revenue: { label: 'CA', color: '#2563eb' },
    profit: { label: 'Profit', color: '#059669' },
    ads: { label: 'Pub', color: '#9333ea' },
    purchase: { label: 'Achat', color: '#ea580c' },
  }

  const toggleSeries = (key: SeriesKey) => {
    setVisibleSeries((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      const enabledCount = Object.values(next).filter(Boolean).length
      return enabledCount === 0 ? prev : next
    })
  }

  // ── Premium chart extras ──

  // Find max revenue and max profit points
  const maxRevenuePoint = useMemo(() => {
    if (!points || points.length < 2) return null
    let maxIdx = 0
    let maxVal = -Infinity
    points.forEach((p, i) => {
      if (p.revenue > maxVal) {
        maxVal = p.revenue
        maxIdx = i
      }
    })
    if (maxVal <= 0 || !isFinite(maxVal)) return null
    return { index: maxIdx, value: maxVal }
  }, [points])

  const maxProfitPoint = useMemo(() => {
    if (!points || points.length < 2) return null
    let maxIdx = 0
    let maxVal = -Infinity
    points.forEach((p, i) => {
      if (p.profit > maxVal) {
        maxVal = p.profit
        maxIdx = i
      }
    })
    if (maxVal <= 0 || !isFinite(maxVal)) return null
    return { index: maxIdx, value: maxVal }
  }, [points])

  return (
    <div className="bg-card rounded-xl shadow p-4 sm:p-6 overflow-hidden">

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4 mb-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            Performance du business
          </h3>
          <p className="text-sm text-muted-foreground mt-1">Selon la période sélectionnée</p>
          {v5Enabled && v5Scope?.incomplete && (
            <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">
              Données partielles : les journées non couvertes sont exclues du graphique.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 justify-start sm:justify-end">
          {(Object.keys(seriesConfig) as SeriesKey[]).filter((key) => allowedSeries.includes(key)).map((key) => (
            <button
              key={key}
              onClick={() => toggleSeries(key)}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                visibleSeries[key] ? 'bg-secondary border-border text-foreground' : 'bg-card border-border text-muted-foreground'
              }`}
            >
              <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: seriesConfig[key].color }} />
              {seriesConfig[key].label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="h-80 flex items-center justify-center text-muted-foreground">Chargement...</div>
      ) : v5Failed || v5NoTotals ? (
        <div className="h-80 flex items-center justify-center px-6 text-center text-muted-foreground">
          {v5Scope?.mixed
            ? 'Plusieurs devises ou niveaux d’accès : les montants ne sont pas additionnés. Sélectionnez une boutique.'
            : v5Failed
              ? 'KPI indisponibles : la lecture V5 a échoué.'
              : 'KPI indisponibles : aucun total exploitable pour cette période.'}
        </div>
      ) : points.length === 0 ? (
        <div className="h-80 flex items-center justify-center text-muted-foreground">Pas de données pour cette période</div>
      ) : (
        <div className="space-y-3">
          <div className="h-80 w-full border border-border rounded-lg p-3 bg-card overflow-hidden">
            <div className="relative w-full h-full pl-10">
              <div className="absolute left-0 top-0 bottom-0 w-9 text-[10px] text-muted-foreground">
                <div className="relative w-full h-full">
                  {yTicks.map((tick, idx) => (
                    <span key={idx} className="absolute left-0" style={{ top: `${valueToY(tick)}%`, transform: 'translateY(-50%)' }}>
                      {formatAxisValue(tick)}
                    </span>
                  ))}
                  {visibleSeries.revenue && maxRevenuePoint && (
                    <span
                      className="absolute right-0 translate-x-1 text-[11px] font-bold tabular-nums"
                      style={{ top: `${valueToY(maxRevenuePoint.value)}%`, transform: 'translateY(-50%)', color: seriesConfig.revenue.color }}
                    >
                      {formatShortCurrency(maxRevenuePoint.value)}
                    </span>
                  )}
                  {allowedSeries.includes('profit') && visibleSeries.profit && maxProfitPoint && (
                    <span
                      className="absolute right-0 translate-x-1 text-[11px] font-bold tabular-nums"
                      style={{ top: `${valueToY(maxProfitPoint.value)}%`, transform: 'translateY(-50%)', color: seriesConfig.profit.color }}
                    >
                      {formatShortCurrency(maxProfitPoint.value)}
                    </span>
                  )}
                </div>
              </div>

              <svg ref={plotRef} viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
                {yTicks.map((tick, idx) => (
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

                {yMin < 0 && yMax > 0 && (
                  <line x1="0" y1={valueToY(0)} x2="100" y2={valueToY(0)} stroke="var(--border)" strokeWidth="0.6" />
                )}

                {(Object.keys(seriesConfig) as SeriesKey[]).map((key) =>
                  allowedSeries.includes(key) && visibleSeries[key] ? (
                    <path
                      key={key}
                      d={buildPath(key)}
                      fill="none"
                      stroke={seriesConfig[key].color}
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null
                )}

                {/* Les points des sommets et leurs labels sont rendus en HTML
                    hors du SVG pour éviter l'étirement horizontal
                    (preserveAspectRatio="none"). */}

                {/* Lignes de sommet discrètes */}
                {visibleSeries.revenue && maxRevenuePoint && (
                  <line
                    x1="0"
                    y1={valueToY(maxRevenuePoint.value)}
                    x2={(maxRevenuePoint.index / (points.length - 1)) * 100}
                    y2={valueToY(maxRevenuePoint.value)}
                    stroke={seriesConfig.revenue.color}
                    strokeWidth="1"
                    opacity="0.5"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {allowedSeries.includes('profit') && visibleSeries.profit && maxProfitPoint && (
                  <line
                    x1="0"
                    y1={valueToY(maxProfitPoint.value)}
                    x2={(maxProfitPoint.index / (points.length - 1)) * 100}
                    y2={valueToY(maxProfitPoint.value)}
                    stroke={seriesConfig.profit.color}
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
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: seriesConfig.revenue.color }} />
                          <span className="text-[11px] text-muted-foreground">CA</span>
                        </div>
                        <span className="text-[11px] font-medium text-foreground/90 tabular-nums">{formatCurrency(points[hoveredIndex].revenue)}</span>
                      </div>
                      {allowedSeries.includes('profit') && <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: seriesConfig.profit.color }} />
                          <span className="text-[11px] text-muted-foreground">Profit</span>
                        </div>
                        <span className="text-[11px] font-medium text-foreground/90 tabular-nums">{formatCurrency(points[hoveredIndex].profit)}</span>
                      </div>}
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: seriesConfig.ads.color }} />
                          <span className="text-[11px] text-muted-foreground">Pub</span>
                        </div>
                        <span className="text-[11px] font-medium text-foreground/90 tabular-nums">{formatCurrency(points[hoveredIndex].ads)}</span>
                      </div>
                      {allowedSeries.includes('profit') && <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#f59e0b' }} />
                          <span className="text-[11px] text-muted-foreground">Livraison</span>
                        </div>
                        <span className="text-[11px] font-medium text-foreground/90 tabular-nums">{formatCurrency(points[hoveredIndex].delivery || 0)}</span>
                      </div>}
                      {allowedSeries.includes('purchase') && <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: seriesConfig.purchase.color }} />
                          <span className="text-[11px] text-muted-foreground">Achat</span>
                        </div>
                        <span className="text-[11px] font-medium text-foreground/90 tabular-nums">{formatCurrency(points[hoveredIndex].purchase)}</span>
                      </div>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="relative h-4 text-xs text-muted-foreground">
            {/* Zone alignée sur le plot : mêmes retraits que le SVG (border 1px + p-3 12px + pl-10 40px à gauche,
                border 1px + p-3 12px à droite). */}
            <div className="absolute inset-y-0 left-[53px] right-[13px]">
              {labelTicks.map((p) => {
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

        </div>
      )}

      <div className="mt-6 pt-6 border-t border-border">
        <div className="mb-4">
          <div className="flex items-center gap-2">
            <h4 className="text-base font-semibold text-foreground">Tunnel de conversion</h4>
            <div className="relative group">
              <button
                type="button"
                aria-label="Règle du tunnel de conversion"
                aria-expanded={showConversionInfo}
                onClick={() => setShowConversionInfo((prev) => !prev)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Info className="w-4 h-4" />
              </button>
              <div
                className={`${
                  showConversionInfo ? 'block' : 'hidden'
                } group-hover:block absolute left-0 top-full mt-2 z-30 w-72 sm:w-80 rounded-md bg-gray-800 text-white text-[11px] leading-4 p-3 shadow-lg space-y-1 text-left font-normal`}
              >
                <div className="font-semibold mb-1">Règle de calcul</div>
                <div><span className="font-medium">Commandes</span> : toutes les commandes de la période.</div>
                <div><span className="font-medium">Confirmées</span> : commandes confirmées, expédiées, livrées et retournées.</div>
                <div><span className="font-medium">Annulées</span> : commandes annulées.</div>
                <div><span className="font-medium">En traitement</span> : commandes pas encore traitées par la confirmation (nouveau, call 1 à 5, sans réponse, faux numéro, répondeur, rejet de confirmation).</div>
                <div><span className="font-medium">Non ramassé</span> : commandes confirmées en attente de ramassage.</div>
                <div><span className="font-medium">Expédiées</span> : commandes expédiées, livrées et retournées.</div>
                <div><span className="font-medium">Livrées</span> : commandes actuellement livrées.</div>
                <div><span className="font-medium">Retour</span> : commandes retournées, stockées ou non stockées.</div>
                <div className="pt-1 text-white/70">Étapes cumulatives : Confirmées ≥ Expédiées ≥ Livrées. Pourcentages calculés sur le total des commandes.</div>
                <div className="text-white/70">Commandes = Confirmées + Annulées + En traitement + Non ramassé.</div>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Base: {baseOrders === null ? '—' : formatNumber(baseOrders)} commandes
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          {conversionStages.map((stage) => (
            <div key={stage.key} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-foreground">{stage.label}</span>
                <span className="text-xs font-semibold text-foreground">
                  {stage.unavailable ? '—' : `${stage.rate.toFixed(1)}%`}
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className={`${stage.color} h-2 rounded-full`} style={{ width: `${Math.min(stage.rate, 100)}%` }} />
              </div>
              <div className={`mt-3 inline-flex px-2 py-0.5 rounded text-[11px] font-medium ${stage.soft}`}>
                {stage.unavailable ? 'Indisponible' : `${formatNumber(stage.count ?? 0)} commandes`}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 pt-6 border-t border-border">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div className="flex items-center justify-between">
            <div className="text-muted-foreground">CA total</div>
            <div className="font-semibold text-foreground">{data ? formatCurrency(data.totalRevenue) : '—'}</div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-muted-foreground">Pub total</div>
            <div className="font-semibold text-foreground">{data ? formatCurrency(data.totalAds) : '—'}</div>
          </div>
          {allowedSeries.includes('purchase') && (
            <>
              <div className="flex items-center justify-between">
                <div className="text-muted-foreground">Achat total</div>
                <div className="font-semibold text-foreground">{data ? formatCurrency(data.totalPurchase) : '—'}</div>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-muted-foreground">Profit total</div>
                <div className={`font-semibold ${data && data.totalProfit < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {data ? formatCurrency(data.totalProfit) : '—'}
                </div>
              </div>
            </>
          )}
          {data && !data.financialAccess && (
            <div className="col-span-2 text-xs text-muted-foreground">Coûts et profit : Non autorisé</div>
          )}
        </div>
      </div>
    </div>
  )
}
