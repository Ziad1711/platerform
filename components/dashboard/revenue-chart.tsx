'use client'

import { useMemo, useState } from 'react'
import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'
import { formatCurrency, getPeriodRange } from '@/lib/utils'

type SeriesKey = 'revenue' | 'profit' | 'ads' | 'purchase'

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
  const abs = Math.abs(value)
  if (abs >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (abs >= 1000) return `${(value / 1000).toFixed(1)}k`
  return Math.round(value).toString()
}

export default function RevenueChart() {
  const { currentStoreId, selectedPeriod, customStartDate, customEndDate, accessibleStoreIds } = useStore()
  const supabase = createClient()
  const periodRange = getPeriodRange(selectedPeriod, { customStartDate, customEndDate })
  const strictPeriodStart = periodRange.start ? startOfDay(periodRange.start) : null
  const strictPeriodEnd = periodRange.end ? startOfDay(periodRange.end) : null
  const [visibleSeries, setVisibleSeries] = useState<Record<SeriesKey, boolean>>({
    revenue: true,
    profit: true,
    ads: true,
    purchase: true,
  })
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-business-trends', currentStoreId, selectedPeriod, customStartDate, customEndDate],
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
        return {
          points: [],
          granularity,
          totalRevenue: 0,
          totalProfit: 0,
          totalAds: 0,
          totalPurchase: 0,
          conversion: {
            totalOrders: 0,
            confirmedOrders: 0,
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
          sent_orders?: number
          delivered_orders?: number
          returned_orders?: number
        }
        totalOrders += Number(conv.total_orders || 0)
        confirmedOrders += Number(conv.confirmed_orders || 0)
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
        granularity,
        totalRevenue,
        totalProfit,
        totalAds,
        totalPurchase,
        conversion: {
          totalOrders,
          confirmedOrders,
          sentOrders,
          deliveredOrders,
          returnedOrders,
          waitingPickupOrders: Number(waitingPickupCount || 0),
        },
      }
    },
  })


  const points = data?.points || []
  const activeKeys = (Object.keys(visibleSeries) as SeriesKey[]).filter((k) => visibleSeries[k])
  const labelStep = points.length > 0 ? Math.max(1, Math.ceil(points.length / 8)) : 1
  const labelTicks = points.filter((_, index) => index % labelStep === 0 || index === points.length - 1)
  const conversion = data?.conversion
  const baseOrders = conversion?.totalOrders || 0
  const waitingPickupOrders = conversion?.waitingPickupOrders || 0
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
      count: conversion?.confirmedOrders || 0,
      color: 'bg-blue-500',
      soft: 'bg-blue-50 text-blue-700',
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
      count: conversion?.sentOrders || 0,
      color: 'bg-indigo-500',
      soft: 'bg-indigo-50 text-indigo-700',
    },
    {
      key: 'delivered',
      label: 'Livrées',
      count: conversion?.deliveredOrders || 0,
      color: 'bg-emerald-500',
      soft: 'bg-emerald-50 text-emerald-700',
    },
    {
      key: 'returned',
      label: 'Retour',
      count: conversion?.returnedOrders || 0,
      color: 'bg-rose-500',
      soft: 'bg-rose-50 text-rose-700',
    },
  ].map((stage) => ({
    ...stage,
    rate: stage.key === 'total' ? (baseOrders > 0 ? 100 : 0) : (baseOrders > 0 ? (stage.count / baseOrders) * 100 : 0),
  }))

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
    return points
      .map((point, index) => {
        const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100
        const raw =
          key === 'revenue'
            ? point.revenue
            : key === 'profit'
            ? point.profit
            : key === 'ads'
            ? point.ads
            : point.purchase
        const y = valueToY(raw)
        return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
      })
      .join(' ')
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

  return (
    <div className="bg-card rounded-xl shadow p-6 overflow-hidden">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            Performance du business
          </h3>
          <p className="text-sm text-muted-foreground mt-1">Selon la période sélectionnée</p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          {(Object.keys(seriesConfig) as SeriesKey[]).map((key) => (
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
      ) : points.length === 0 ? (
        <div className="h-80 flex items-center justify-center text-muted-foreground">Pas de données pour cette période</div>
      ) : (
        <div className="space-y-3">
          <div className="h-80 w-full border border-border rounded-lg p-3 bg-card overflow-hidden">
            <div className="relative w-full h-full pl-10">
              <div className="absolute left-0 top-0 bottom-0 w-9 flex flex-col justify-between text-[10px] text-muted-foreground">
                {yTicks.map((tick, idx) => (
                  <span key={idx}>{formatAxisValue(tick)}</span>
                ))}
              </div>

              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
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
                  visibleSeries[key] ? (
                    <path
                      key={key}
                      d={buildPath(key)}
                      fill="none"
                      stroke={seriesConfig[key].color}
                      strokeWidth="1.4"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null
                )}

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
                  {points.map((_, index) => (
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
                  <div>CA: {formatCurrency(points[hoveredIndex].revenue)}</div>
                  <div>Profit: {formatCurrency(points[hoveredIndex].profit)}</div>
                  <div>Pub: {formatCurrency(points[hoveredIndex].ads)}</div>
                  <div>Livraison: {formatCurrency(points[hoveredIndex].delivery || 0)}</div>
                  <div>Achat: {formatCurrency(points[hoveredIndex].purchase)}</div>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-between text-xs text-muted-foreground gap-2">
            {labelTicks.map((p, i) => (
              <span key={`${p.date}-${i}`} className="text-center">
                {p.label}
              </span>
            ))}
          </div>

        </div>
      )}

      <div className="mt-6 pt-6 border-t border-border">
        <div className="mb-4">
          <h4 className="text-base font-semibold text-foreground">Tunnel de conversion</h4>
          <p className="text-xs text-muted-foreground mt-1">Base: {baseOrders} commandes</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
          {conversionStages.map((stage) => (
            <div key={stage.key} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground">{stage.label}</span>
                <span className="text-sm font-semibold text-foreground">{stage.rate.toFixed(1)}%</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className={`${stage.color} h-2 rounded-full`} style={{ width: `${Math.min(stage.rate, 100)}%` }} />
              </div>
              <div className={`mt-3 inline-flex px-2 py-1 rounded text-xs font-medium ${stage.soft}`}>
                {stage.count} commandes
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 pt-6 border-t border-border">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div className="flex items-center justify-between">
            <div className="text-muted-foreground">CA total</div>
            <div className="font-semibold text-foreground">{formatCurrency(data?.totalRevenue || 0)}</div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-muted-foreground">Pub total</div>
            <div className="font-semibold text-foreground">{formatCurrency(data?.totalAds || 0)}</div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-muted-foreground">Achat total</div>
            <div className="font-semibold text-foreground">{formatCurrency(data?.totalPurchase || 0)}</div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-muted-foreground">Profit total</div>
            <div className={`font-semibold ${(data?.totalProfit || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {formatCurrency(data?.totalProfit || 0)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}