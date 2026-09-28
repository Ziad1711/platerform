'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useStore } from '@/lib/store-context'
import { formatCurrency, getPeriodRange } from '@/lib/utils'
import { TrendingUp } from 'lucide-react'
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
} from 'recharts'

type DayRow = {
  day: string
  revenue: number
  operating_result: number
  currency: string | null
}

function formatAxisValue(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (abs >= 1000) return `${(value / 1000).toFixed(1)}k`
  return Math.round(value).toString()
}

function formatDayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`)
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

export default function FinanceTrendChart() {
  const { currentStoreId, accessibleStoreIds, selectedPeriod, customStartDate, customEndDate } = useStore()
  const supabase = createClient()
  const targetStoreIds = currentStoreId ? [currentStoreId] : accessibleStoreIds
  const range = getPeriodRange(selectedPeriod, { customStartDate, customEndDate })

  const { data, isLoading } = useQuery({
    queryKey: ['finance-trend-chart', currentStoreId, accessibleStoreIds, selectedPeriod, customStartDate, customEndDate],
    enabled: targetStoreIds.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        targetStoreIds.map(async (storeId) => {
          const { data, error } = await supabase.rpc('rpc_finance_daily_series', {
            p_store_id: storeId,
            p_start_date: range.start ? range.start.toISOString() : null,
            p_end_date: range.end ? range.end.toISOString() : null,
          })
          if (error) throw error
          return (data || []) as DayRow[]
        })
      )

      const flat = results.flat()
      const currencies = new Set(flat.map((r) => r.currency).filter(Boolean))
      const currency = currencies.size === 1 ? (flat[0]?.currency || 'MAD') : null

      const byDay = new Map<string, { revenue: number; operating_result: number }>()
      for (const row of flat) {
        const entry = byDay.get(row.day) || { revenue: 0, operating_result: 0 }
        entry.revenue += Number(row.revenue) || 0
        entry.operating_result += Number(row.operating_result) || 0
        byDay.set(row.day, entry)
      }

      const points = Array.from(byDay.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([day, v]) => ({
          day,
          label: formatDayLabel(day),
          revenue: v.revenue,
          operating_result: v.operating_result,
        }))

      return { points, currency }
    },
  })

  const points = data?.points || []
  const currency = data?.currency || 'MAD'
  const mixedCurrency = points.length > 0 && !data?.currency

  const totalRevenue = points.reduce((s, p) => s + p.revenue, 0)
  const totalResult = points.reduce((s, p) => s + p.operating_result, 0)

  const renderTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean
    payload?: Array<{ name?: string; value?: number; color?: string }>
    label?: string
  }) => {
    if (!active || !payload || payload.length === 0) return null
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-lg text-sm">
        <div className="font-medium text-foreground mb-1">{label}</div>
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
              {entry.name}
            </span>
            <span className="font-medium text-foreground">{formatCurrency(entry.value || 0, currency)}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="p-5 border-b border-border/50">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold text-foreground">Chiffre d&apos;affaires &amp; résultat</h2>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>
              CA : <span className="font-semibold text-foreground">{formatCurrency(totalRevenue, currency)}</span>
            </span>
            <span>
              Résultat :{' '}
              <span className={`font-semibold ${totalResult >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatCurrency(totalResult, currency)}
              </span>
            </span>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {isLoading ? (
          <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">Chargement…</div>
        ) : mixedCurrency ? (
          <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
            Sélectionnez un store : les stores utilisent des devises différentes.
          </div>
        ) : points.length === 0 ? (
          <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
            Pas de données pour cette période.
          </div>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="financeRevenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1fa971" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#1fa971" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatAxisValue}
                  width={48}
                />
                <Tooltip content={renderTooltip} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="Chiffre d'affaires"
                  stroke="#1fa971"
                  strokeWidth={2}
                  fill="url(#financeRevenueFill)"
                />
                <Line
                  type="monotone"
                  dataKey="operating_result"
                  name="Résultat opérationnel"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  )
}
