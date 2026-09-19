'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Clock, Flame, RotateCcw } from 'lucide-react'
import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { getPeriodRange } from '@/lib/utils'

type StatusFilter = 'all' | 'confirmed' | 'delivered'
type ViewMode = 'day' | 'hour'

type SlotRow = {
  week_day: number
  hour_of_day: number
  orders_count: number
  confirmed_count: number
  delivered_count: number
}

const WEEKDAY_LABELS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
const WEEKDAY_SHORT = ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.', 'Dim.']
const PRIMARY_COLOR = '#1fa971'
const MUTED_BAR_COLOR = 'rgba(31, 169, 113, 0.35)'

function metricValue(row: SlotRow, filter: StatusFilter) {
  if (filter === 'confirmed') return Number(row.confirmed_count || 0)
  if (filter === 'delivered') return Number(row.delivered_count || 0)
  return Number(row.orders_count || 0)
}

function formatHourRange(hour: number) {
  const next = (hour + 1) % 24
  return `${String(hour).padStart(2, '0')}h – ${String(next).padStart(2, '0')}h`
}

function formatPercent(value: number, total: number) {
  if (total <= 0) return '0 %'
  return `${((value / total) * 100).toFixed(1).replace('.', ',')} %`
}

export default function OrderTimePerformance() {
  const {
    currentStoreId,
    accessibleStoreIds,
    selectedPeriod,
    customStartDate,
    customEndDate,
    isStoresLoading,
    userId,
    authReady,
  } = useStore()
  const supabase = createClient()
  const periodRange = getPeriodRange(selectedPeriod, { customStartDate, customEndDate })
  const startIso = periodRange.start ? periodRange.start.toISOString() : null
  const endIso = periodRange.end ? periodRange.end.toISOString() : null

  const [viewMode, setViewMode] = useState<ViewMode>('day')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const { data: timezone } = useQuery({
    queryKey: ['user-timezone', userId],
    enabled: authReady && Boolean(userId),
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('timezone').eq('id', userId).maybeSingle()
      return data?.timezone || 'Africa/Casablanca'
    },
  })

  const storeIds = currentStoreId ? [currentStoreId] : accessibleStoreIds
  const hasStores = storeIds.length > 0

  const { data, isLoading } = useQuery({
    queryKey: [
      'dashboard-order-time-performance',
      currentStoreId,
      accessibleStoreIds,
      selectedPeriod,
      customStartDate,
      customEndDate,
    ],
    enabled: !isStoresLoading && hasStores && Boolean(timezone),
    queryFn: async () => {
      const { data: rows, error } = await supabase.rpc('rpc_dashboard_order_time_performance', {
        p_store_ids: currentStoreId ? [currentStoreId] : accessibleStoreIds,
        p_start_date: startIso,
        p_end_date: endIso,
        p_timezone: timezone || 'Africa/Casablanca',
      })
      if (error) throw error
      return (rows || []) as SlotRow[]
    },
  })

  const { matrix, total } = useMemo(() => {
    const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
    let sum = 0
    for (const row of data || []) {
      const day = Number(row.week_day) - 1
      const hour = Number(row.hour_of_day)
      if (day < 0 || day > 6 || hour < 0 || hour > 23) continue
      const value = metricValue(row, statusFilter)
      grid[day][hour] += value
      sum += value
    }
    return { matrix: grid, total: sum }
  }, [data, statusFilter])

  const dayTotals = useMemo(() => matrix.map((hours) => hours.reduce((acc, value) => acc + value, 0)), [matrix])
  const hourTotals = useMemo(
    () => Array.from({ length: 24 }, (_, hour) => matrix.reduce((acc, row) => acc + row[hour], 0)),
    [matrix]
  )

  // Nombre d'occurrences de chaque jour sur la période (pour comparer des moyennes)
  const weekdayOccurrences = useMemo(() => {
    const counts = Array<number>(7).fill(0)
    if (!startIso) return counts
    const start = new Date(startIso)
    start.setHours(0, 0, 0, 0)
    const rawEnd = endIso ? new Date(endIso) : new Date()
    const todayEnd = new Date()
    todayEnd.setHours(0, 0, 0, 0)
    todayEnd.setDate(todayEnd.getDate() + 1)
    const end = rawEnd > todayEnd ? todayEnd : rawEnd
    const cursor = new Date(start)
    while (cursor < end) {
      counts[(cursor.getDay() + 6) % 7] += 1
      cursor.setDate(cursor.getDate() + 1)
    }
    return counts
  }, [startIso, endIso])

  const bestDayIndex = useMemo(() => {
    let best = -1
    let bestScore = -1
    dayTotals.forEach((value, index) => {
      if (value <= 0) return
      const occurrences = weekdayOccurrences[index] || 0
      const score = occurrences > 0 ? value / occurrences : value
      if (score > bestScore) {
        bestScore = score
        best = index
      }
    })
    return best
  }, [dayTotals, weekdayOccurrences])

  const bestHourIndex = useMemo(() => {
    let best = -1
    let bestValue = 0
    hourTotals.forEach((value, hour) => {
      if (value > bestValue) {
        bestValue = value
        best = hour
      }
    })
    return best
  }, [hourTotals])

  const bestSlot = useMemo(() => {
    let slot: { day: number; hour: number; value: number } | null = null
    matrix.forEach((hours, day) => {
      hours.forEach((value, hour) => {
        if (!slot || value > slot.value) slot = { day, hour, value }
      })
    })
    const resolved = slot as { day: number; hour: number; value: number } | null
    return resolved && resolved.value > 0 ? resolved : null
  }, [matrix])

  const chartSeries = useMemo(() => {
    if (viewMode === 'hour') {
      const hours = selectedDay !== null ? matrix[selectedDay] : hourTotals
      return hours.map((value, hour) => ({
        key: `h-${hour}`,
        label: `${String(hour).padStart(2, '0')}h`,
        fullLabel: formatHourRange(hour),
        value,
      }))
    }
    return dayTotals.map((value, index) => ({
      key: `d-${index}`,
      label: WEEKDAY_SHORT[index],
      fullLabel: WEEKDAY_LABELS[index],
      value,
    }))
  }, [viewMode, selectedDay, matrix, dayTotals, hourTotals])

  const maxValue = useMemo(() => chartSeries.reduce((acc, item) => Math.max(acc, item.value), 0), [chartSeries])

  const defaultIndex = useMemo(() => {
    if (viewMode === 'hour') {
      const hours = selectedDay !== null ? matrix[selectedDay] : hourTotals
      let index = -1
      let best = 0
      hours.forEach((value, hour) => {
        if (value > best) {
          best = value
          index = hour
        }
      })
      return index >= 0 ? index : null
    }
    return bestDayIndex >= 0 ? bestDayIndex : null
  }, [viewMode, selectedDay, matrix, hourTotals, bestDayIndex])

  const displayIndex = activeIndex !== null ? activeIndex : defaultIndex
  const focusedSlot = displayIndex !== null ? chartSeries[displayIndex] : null

  const handleBarClick = (index: number) => {
    if (viewMode === 'day') {
      setSelectedDay(index)
      setViewMode('hour')
      setActiveIndex(null)
    }
  }

  const resetToDays = () => {
    setViewMode('day')
    setSelectedDay(null)
    setActiveIndex(null)
  }

  const detailLabel = (() => {
    if (!focusedSlot) return 'Aucune donnée'
    if (viewMode === 'hour') {
      const prefix = selectedDay !== null ? `${WEEKDAY_LABELS[selectedDay]} · ` : ''
      return `${prefix}${focusedSlot.fullLabel} — ${focusedSlot.value} commandes (${formatPercent(focusedSlot.value, total)})`
    }
    const occurrences = weekdayOccurrences[displayIndex ?? 0] || 0
    const average = occurrences > 0 ? focusedSlot.value / occurrences : 0
    const averageText = occurrences > 1 ? ` • Moyenne : ${average.toFixed(1).replace('.', ',')} commandes` : ''
    return `${focusedSlot.fullLabel} — ${focusedSlot.value} commandes (${formatPercent(focusedSlot.value, total)})${averageText}`
  })()

  return (
    <div className="bg-card rounded-xl shadow">
      <div className="p-6 border-b border-border flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Meilleurs jours et heures de commande</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Répartition selon la période sélectionnée
              {timezone ? ` • ${timezone}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
              <button
                type="button"
                onClick={resetToDays}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === 'day' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Par jour
              </button>
              <button
                type="button"
                onClick={() => setViewMode('hour')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === 'hour' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Par heure
              </button>
            </div>
            <select
              className="border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary bg-card text-foreground"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="all">Toutes les commandes</option>
              <option value="confirmed">Confirmées</option>
              <option value="delivered">Livrées</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-border px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CalendarDays className="w-3.5 h-3.5" />
              Meilleur jour
            </div>
            <div className="mt-1 text-sm font-semibold text-foreground">
              {bestDayIndex >= 0 ? WEEKDAY_LABELS[bestDayIndex] : '—'}
            </div>
            <div className="text-xs text-muted-foreground">
              {bestDayIndex >= 0 ? `${dayTotals[bestDayIndex]} commandes` : 'Pas de données'}
            </div>
          </div>
          <div className="rounded-lg border border-border px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              Meilleure heure
            </div>
            <div className="mt-1 text-sm font-semibold text-foreground">
              {bestHourIndex >= 0 ? formatHourRange(bestHourIndex) : '—'}
            </div>
            <div className="text-xs text-muted-foreground">
              {bestHourIndex >= 0 ? `${hourTotals[bestHourIndex]} commandes` : 'Pas de données'}
            </div>
          </div>
          <div className="rounded-lg border border-border px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Flame className="w-3.5 h-3.5" />
              Créneau dominant
            </div>
            <div className="mt-1 text-sm font-semibold text-foreground">
              {bestSlot ? `${WEEKDAY_LABELS[bestSlot.day]} · ${formatHourRange(bestSlot.hour)}` : '—'}
            </div>
            <div className="text-xs text-muted-foreground">
              {bestSlot ? `${bestSlot.value} commandes (${formatPercent(bestSlot.value, total)})` : 'Pas de données'}
            </div>
          </div>
        </div>
      </div>

      <div className="p-6">
        {isLoading ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground">Chargement...</div>
        ) : total === 0 ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground">
            Aucune commande pour cette période
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="text-sm font-medium text-foreground">
                {viewMode === 'hour' && selectedDay !== null
                  ? `Commandes du ${WEEKDAY_LABELS[selectedDay].toLowerCase()} par heure`
                  : viewMode === 'hour'
                  ? 'Commandes par heure'
                  : 'Commandes par jour'}
              </div>
              {viewMode === 'hour' && selectedDay !== null && (
                <button
                  type="button"
                  onClick={resetToDays}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Retour à tous les jours
                </button>
              )}
            </div>

            <div className="h-64 flex items-end gap-1 sm:gap-2 border-b border-border">
              {chartSeries.map((item, index) => {
                const heightPct = maxValue > 0 ? (item.value / maxValue) * 100 : 0
                const isHighlighted = index === displayIndex
                return (
                  <button
                    key={item.key}
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseLeave={() => setActiveIndex(null)}
                    onFocus={() => setActiveIndex(index)}
                    onBlur={() => setActiveIndex(null)}
                    onClick={() => handleBarClick(index)}
                    aria-label={`${item.fullLabel} : ${item.value} commandes`}
                    className="flex-1 h-full min-w-0 flex flex-col justify-end items-center gap-1 rounded-t-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span
                      className={`text-[10px] sm:text-xs tabular-nums ${
                        isHighlighted ? 'font-semibold text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      {item.value > 0 ? item.value : ''}
                    </span>
                    <span
                      className="w-full rounded-t-md transition-all duration-200"
                      style={{
                        height: `${item.value > 0 ? Math.max(heightPct, 2) : 0.6}%`,
                        backgroundColor:
                          item.value === 0
                            ? 'hsl(var(--border))'
                            : isHighlighted
                            ? PRIMARY_COLOR
                            : MUTED_BAR_COLOR,
                      }}
                    />
                  </button>
                )
              })}
            </div>

            <div className="flex gap-1 sm:gap-2">
              {chartSeries.map((item, index) => {
                const showLabel = viewMode === 'day' || index % 3 === 0 || index === displayIndex
                return (
                  <span
                    key={`label-${item.key}`}
                    className="flex-1 min-w-0 text-center text-[10px] sm:text-xs text-muted-foreground"
                  >
                    {showLabel ? item.label : ''}
                  </span>
                )
              })}
            </div>

            <div className="text-xs text-muted-foreground">{detailLabel}</div>

            {viewMode === 'day' && (
              <p className="text-[11px] text-muted-foreground">
                Cliquez sur un jour pour afficher le détail de ses heures.
              </p>
            )}

            {total > 0 && total < 30 && (
              <p className="text-[11px] text-amber-600">
                Échantillon faible : tendance à confirmer avec davantage de commandes.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
