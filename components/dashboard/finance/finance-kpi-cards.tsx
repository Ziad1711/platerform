'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useStore } from '@/lib/store-context'
import { formatCurrency, formatNumber, getPeriodRange, type DashboardPeriod } from '@/lib/utils'
import { Banknote, TrendingUp, TrendingDown, Percent, Target, ShoppingBag, Receipt, Info } from 'lucide-react'

type OverviewRow = {
  store_id: string
  currency: string | null
  revenue: number
  cost_of_goods: number
  delivery_cost: number
  ad_spend: number
  commission: number
  other_expenses: number
  operating_result: number
  delivered_orders: number
  estimated_orders: number
  data_issues: number
  result_is_reliable: boolean
}

type NumericKey =
  | 'revenue'
  | 'cost_of_goods'
  | 'delivery_cost'
  | 'ad_spend'
  | 'commission'
  | 'other_expenses'
  | 'operating_result'
  | 'delivered_orders'

function num(rows: OverviewRow[], key: NumericKey): number {
  return rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0)
}

function unifiedCurrency(rows: OverviewRow[]): string | null {
  if (rows.length === 0) return null
  const currencies = new Set(rows.map((r) => r.currency || 'MAD'))
  return currencies.size === 1 ? (rows[0]?.currency || 'MAD') : null
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function diffDays(a: Date, b: Date): number {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000))
}

function getPreviousRange(
  period: DashboardPeriod,
  range: { start: Date | null; end: Date | null },
  customStartDate: string | null,
  customEndDate: string | null
): { start: Date | null; end: Date | null } {
  if (period === 'all') return { start: null, end: null }
  if (!range.start) return { start: null, end: null }

  if (period === 'custom') {
    const start = customStartDate ? new Date(`${customStartDate}T00:00:00`) : range.start
    const end = customEndDate ? new Date(`${customEndDate}T00:00:00`) : range.end ?? new Date()
    const days = Math.max(1, diffDays(start, end))
    return { start: addDays(start, -days), end: start }
  }

  const days = Math.max(1, diffDays(range.start, range.end ?? new Date()))
  return { start: addDays(range.start, -days), end: range.start }
}

function calcPctChange(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100
  return ((current - previous) / Math.abs(previous)) * 100
}

function formatChange(value: number): string {
  const rounded = Number.isFinite(value) ? value : 0
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}%`
}

function shouldShow(value: number | null): boolean {
  return value !== null && Number.isFinite(value) && Math.abs(value) >= 0.05
}

export default function FinanceKpiCards() {
  const { currentStoreId, accessibleStoreIds, selectedPeriod, customStartDate, customEndDate } = useStore()
  const supabase = createClient()
  const targetStoreIds = currentStoreId ? [currentStoreId] : accessibleStoreIds

  const { data, isLoading } = useQuery({
    queryKey: ['finance-kpi-summary', currentStoreId, accessibleStoreIds, selectedPeriod, customStartDate, customEndDate],
    enabled: targetStoreIds.length > 0,
    queryFn: async () => {
      const currentRange = getPeriodRange(selectedPeriod, { customStartDate, customEndDate })
      const previousRange = getPreviousRange(selectedPeriod, currentRange, customStartDate, customEndDate)

      const fetchRows = async (range: { start: Date | null; end: Date | null }): Promise<OverviewRow[]> => {
        if (!range.start) return []
        const results = await Promise.all(
          targetStoreIds.map(async (storeId) => {
            const { data, error } = await supabase.rpc('rpc_finance_overview', {
              p_store_id: storeId,
              p_start_date: range.start ? range.start.toISOString() : null,
              p_end_date: range.end ? range.end.toISOString() : null,
            })
            if (error) throw error
            return (data?.[0] || null) as OverviewRow | null
          })
        )
        return results.filter(Boolean) as OverviewRow[]
      }

      const [current, previous] = await Promise.all([fetchRows(currentRange), fetchRows(previousRange)])
      return { current, previous }
    },
  })

  const current = data?.current || []
  const previous = data?.previous || []

  const currency = unifiedCurrency(current)

  const revenue = num(current, 'revenue')
  const operatingResult = num(current, 'operating_result')
  const adSpend = num(current, 'ad_spend')
  const costOfGoods = num(current, 'cost_of_goods')
  const deliveredOrders = num(current, 'delivered_orders')

  const grossMargin = revenue - costOfGoods
  const grossMarginRate = revenue > 0 ? (grossMargin / revenue) * 100 : null
  const marginRate = revenue > 0 ? (operatingResult / revenue) * 100 : null
  const averageOrderValue = deliveredOrders > 0 ? revenue / deliveredOrders : null

  const prevRevenue = num(previous, 'revenue')
  const prevOperatingResult = num(previous, 'operating_result')
  const prevAdSpend = num(previous, 'ad_spend')
  const prevMarginRate = prevRevenue > 0 ? (prevOperatingResult / prevRevenue) * 100 : null

  const revenueChange = calcPctChange(revenue, prevRevenue)
  const resultChange = calcPctChange(operatingResult, prevOperatingResult)
  const adSpendChange = calcPctChange(adSpend, prevAdSpend)
  const marginChangePts = marginRate !== null && prevMarginRate !== null ? marginRate - prevMarginRate : null

  const notReliable = current.some((r) => !r.result_is_reliable)
  const hasEstimated = current.some((r) => Number(r.estimated_orders) > 0)
  const reliabilityBadge = notReliable ? (hasEstimated ? 'Estimé' : 'À vérifier') : null

  const money = (value: number) => (currency ? formatCurrency(value, currency) : '—')

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5">
            <div className="animate-pulse h-4 w-10 bg-secondary rounded" />
            <div className="mt-4 animate-pulse h-8 w-28 bg-secondary rounded mb-2" />
            <div className="animate-pulse h-3 w-20 bg-secondary rounded" />
          </div>
        ))}
      </div>
    )
  }

  type CardDef = {
    key: string
    label: string
    value: string
    hint: string | null
    change: string | null
    up: boolean
    icon: typeof Banknote
    chip: string
    valueClass?: string
    badge?: string | null
    invert?: boolean
  }

  const primaryCards: CardDef[] = [
    {
      key: 'revenue',
      label: "Chiffre d'affaires (livré)",
      value: money(revenue),
      hint: revenue > 0 ? `${formatNumber(deliveredOrders)} commande(s) livrée(s)` : null,
      change: shouldShow(revenueChange) ? formatChange(revenueChange) : null,
      up: revenueChange >= 0,
      icon: Banknote,
      chip: 'bg-emerald-500/10 text-emerald-600',
    },
    {
      key: 'result',
      label: 'Résultat opérationnel',
      value: money(operatingResult),
      hint: null,
      change: shouldShow(resultChange) ? formatChange(resultChange) : null,
      up: resultChange >= 0,
      icon: TrendingUp,
      chip: operatingResult >= 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600',
      valueClass: operatingResult >= 0 ? 'text-emerald-600' : 'text-red-600',
      badge: reliabilityBadge,
    },
    {
      key: 'margin',
      label: 'Marge opérationnelle',
      value: marginRate !== null && currency ? `${marginRate.toFixed(1)}%` : '—',
      hint: revenue > 0 ? `${money(grossMargin)} de marge brute` : null,
      change:
        marginChangePts !== null && Math.abs(marginChangePts) >= 0.05
          ? `${marginChangePts > 0 ? '+' : ''}${marginChangePts.toFixed(1)} pts`
          : null,
      up: (marginChangePts ?? 0) >= 0,
      icon: Percent,
      chip: 'bg-blue-500/10 text-blue-600',
    },
    {
      key: 'ads',
      label: 'Dépenses publicitaires',
      value: money(adSpend),
      hint: revenue > 0 ? `${((adSpend / revenue) * 100).toFixed(1)}% du CA` : null,
      change: shouldShow(adSpendChange) ? formatChange(adSpendChange) : null,
      up: adSpendChange >= 0,
      invert: true,
      icon: Target,
      chip: 'bg-purple-500/10 text-purple-600',
    },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {primaryCards.map((card) => {
          const Icon = card.icon
          const up = card.up
          return (
            <div key={card.key} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start justify-between">
                <div className={`${card.chip} p-2 rounded-lg`}>
                  <Icon className="w-5 h-5" />
                </div>
                {card.change ? (
                  <div
                    className={`flex items-center text-xs ${
                      card.invert ? (up ? 'text-red-600' : 'text-emerald-600') : up ? 'text-emerald-600' : 'text-red-600'
                    }`}
                  >
                    {up ? <TrendingUp className="w-3.5 h-3.5 mr-1" /> : <TrendingDown className="w-3.5 h-3.5 mr-1" />}
                    {card.change}
                  </div>
                ) : (
                  <div className="w-12" />
                )}
              </div>
              <div className="mt-4">
                <div className={`text-2xl font-bold text-foreground ${card.valueClass || ''}`}>{card.value}</div>
                <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <span>{card.label}</span>
                  {card.badge && (
                    <span className="rounded-full bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                      {card.badge}
                    </span>
                  )}
                  {card.hint && !card.badge && (
                    <span className="relative group">
                      <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Détail">
                        <Info className="w-3.5 h-3.5" />
                      </button>
                      <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded-md bg-gray-800 text-white text-[11px] leading-4 p-2 shadow-lg z-20">
                        {card.hint}
                      </div>
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat icon={ShoppingBag} label="Marge brute" value={money(grossMargin)} sub={grossMarginRate !== null ? `${grossMarginRate.toFixed(1)}% du CA` : null} />
        <Stat icon={Receipt} label="Panier moyen livré" value={averageOrderValue !== null ? money(averageOrderValue) : '—'} sub={null} />
        <Stat icon={TrendingUp} label="Commandes livrées" value={formatNumber(deliveredOrders)} sub={null} />
      </div>
    </div>
  )
}

function Stat({ icon: Icon, label, value, sub }: { icon: typeof Banknote; label: string; value: string; sub: string | null }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
      <div className="bg-secondary/70 p-2 rounded-lg">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <div className="text-lg font-semibold text-foreground truncate">{value}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          {label}
          {sub && <span className="text-muted-foreground/70">· {sub}</span>}
        </div>
      </div>
    </div>
  )
}
