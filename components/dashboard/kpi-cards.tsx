'use client'

import { TrendingUp, TrendingDown, DollarSign, ShoppingCart, Target, Package, Truck, Info } from 'lucide-react'
import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'
import { formatCurrency, getPeriodRange } from '@/lib/utils'
import AdsCostChart from '@/components/dashboard/ads-cost-chart'

interface KpiData {
  orders: number
  deliveredOrders: number
  revenue: number
  purchaseCost: number
  adSpend: number
  adCost: number
  deliveryCost: number
  confirmationCost: number
  profit: number
  averageOrderValue: number
  deliveredRate: number
  cpl: number
  cpa: number
  roas: number
  marginRate: number
}

interface KpiChanges {
  orders: number
  deliveredOrders: number
  revenue: number
  charges: number
  adSpend: number
  adCost: number
  profit: number
  deliveryCost: number
  cpl: number
  cpa: number
  confirmationCost: number
  roas: number
  marginRate: number
}

interface KpiResult extends KpiData {
  changes: KpiChanges
}

interface DateRange {
  start: Date | null
  end: Date | null
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function diffDays(start: Date, end: Date) {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))
}

function getPreviousRange(selectedPeriod: string, currentRange: DateRange): DateRange {
  const now = new Date()

  if (selectedPeriod === 'today') {
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const yesterdayStart = addDays(todayStart, -1)
    return { start: yesterdayStart, end: todayStart }
  }

  if (selectedPeriod === 'yesterday') {
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const yesterdayStart = addDays(todayStart, -1)
    const dayBeforeStart = addDays(todayStart, -2)
    return { start: dayBeforeStart, end: yesterdayStart }
  }

  if (selectedPeriod === 'week') {
    const end = currentRange.start
    const start = end ? addDays(end, -7) : null
    return { start, end }
  }

  if (selectedPeriod === 'month') {
    const currentMonthStart = currentRange.start
    if (!currentMonthStart) return { start: null, end: null }
    const previousMonthStart = new Date(currentMonthStart.getFullYear(), currentMonthStart.getMonth() - 1, 1)
    return { start: previousMonthStart, end: currentMonthStart }
  }

  if (selectedPeriod === 'quarter') {
    const currentQuarterStart = currentRange.start
    if (!currentQuarterStart) return { start: null, end: null }
    const previousQuarterStart = new Date(currentQuarterStart.getFullYear(), currentQuarterStart.getMonth() - 3, 1)
    return { start: previousQuarterStart, end: currentQuarterStart }
  }

  if (selectedPeriod === 'year') {
    const currentYearStart = currentRange.start
    if (!currentYearStart) return { start: null, end: null }
    const previousYearStart = new Date(currentYearStart.getFullYear() - 1, 0, 1)
    return { start: previousYearStart, end: currentYearStart }
  }

  if (selectedPeriod === 'custom' && currentRange.start && currentRange.end) {
    const days = diffDays(currentRange.start, currentRange.end)
    const previousEnd = currentRange.start
    const previousStart = addDays(previousEnd, -days)
    return { start: previousStart, end: previousEnd }
  }

  if (currentRange.start && currentRange.end) {
    const days = diffDays(currentRange.start, currentRange.end)
    const previousEnd = currentRange.start
    const previousStart = addDays(previousEnd, -days)
    return { start: previousStart, end: previousEnd }
  }

  return { start: null, end: null }
}

function calcPctChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100
  return ((current - previous) / Math.abs(previous)) * 100
}

function formatChange(value: number) {
  const rounded = Number.isFinite(value) ? value : 0
  const sign = rounded > 0 ? '+' : ''
  return `${sign}${rounded.toFixed(1)}%`
}

function shouldShowChange(value: number) {
  return Math.abs(value) >= 0.05
}

interface KpiCardsProps {
  variant?: 'primary' | 'marketing'
}

export default function KpiCards({ variant = 'primary' }: KpiCardsProps) {
  const { currentStoreId, selectedPeriod, customStartDate, customEndDate, accessibleStoreIds, isStoresLoading } = useStore()
  const supabase = createClient()
  const periodRange = getPeriodRange(selectedPeriod, { customStartDate, customEndDate })

  const { data: kpiData, isLoading } = useQuery<KpiResult>({
    queryKey: ['dashboard-kpis', currentStoreId, selectedPeriod, customStartDate, customEndDate, accessibleStoreIds],
    enabled: !isStoresLoading,
    queryFn: async () => {
      const previousRange = getPreviousRange(selectedPeriod, periodRange)

      const fetchMetrics = async (range: DateRange): Promise<KpiData> => {
        const storeIds = currentStoreId ? [currentStoreId] : accessibleStoreIds

        if (storeIds.length === 0) {
          return {
            orders: 0,
            deliveredOrders: 0,
            revenue: 0,
            purchaseCost: 0,
            adSpend: 0,
            adCost: 0,
            deliveryCost: 0,
            confirmationCost: 0,
            profit: 0,
            averageOrderValue: 0,
            deliveredRate: 0,
            cpl: 0,
            cpa: 0,
            roas: 0,
            marginRate: 0,
          }
        }

        const [results, topProductsResults] = await Promise.all([
          Promise.all(
            storeIds.map(async (storeId) => {
              const { data, error } = await supabase.rpc('rpc_dashboard_kpi_metrics', {
                p_store_id: storeId,
                p_start_date: range.start ? range.start.toISOString() : null,
                p_end_date: range.end ? range.end.toISOString() : null,
              })

              if (error) throw error

              return (data?.[0] || {}) as {
                orders_count?: number
                delivered_count?: number
                revenue?: number
                purchase_cost?: number
                ad_spend?: number
                ad_cost_allocated?: number
                delivery_cost?: number
                confirmation_cost?: number
              }
            })
          ),

          Promise.all(
            storeIds.map(async (storeId) => {
              const { data, error } = await supabase.rpc('rpc_dashboard_top_products', {
                p_store_id: storeId,
                p_start_date: range.start ? range.start.toISOString() : null,
                p_end_date: range.end ? range.end.toISOString() : null,
              })

              if (error) throw error

              return (data || []) as Array<{ revenue?: number }>
            })
          ),
        ])

        type AggregatedRow = {
          orders_count: number
          delivered_count: number
          revenue: number
          purchase_cost: number
          ad_spend: number
          ad_cost_allocated: number
          delivery_cost: number
          confirmation_cost: number
        }

        const aggregated = results.reduce<AggregatedRow>(
          (acc, row) => {
            acc.orders_count += Number(row.orders_count || 0)
            acc.delivered_count += Number(row.delivered_count || 0)
            acc.revenue += Number(row.revenue || 0)
            acc.purchase_cost += Number(row.purchase_cost || 0)
            acc.ad_spend += Number(row.ad_spend || 0)
            acc.ad_cost_allocated += Number(row.ad_cost_allocated || 0)
            acc.delivery_cost += Number(row.delivery_cost || 0)
            acc.confirmation_cost += Number(row.confirmation_cost || 0)
            return acc
          },
          {
            orders_count: 0,
            delivered_count: 0,
            revenue: 0,
            purchase_cost: 0,
            ad_spend: 0,
            ad_cost_allocated: 0,
            delivery_cost: 0,
            confirmation_cost: 0,
          }
        )

        const ordersCount = aggregated.orders_count
        const deliveredOrdersCount = aggregated.delivered_count
        const revenue = topProductsResults
          .flat()
          .reduce((sum, row) => sum + Number(row.revenue || 0), 0)
        
        const purchaseCost = aggregated.purchase_cost
        const adSpendTotal = aggregated.ad_spend
        const allocatedAdCost = aggregated.ad_cost_allocated
        const effectiveAdSpend = adSpendTotal > 0 ? adSpendTotal : allocatedAdCost
        const adCost = effectiveAdSpend
        const deliveryCost = aggregated.delivery_cost // This is usually the cost paid to delivery company
        const confirmationCost = aggregated.confirmation_cost
        
        // Profit = Revenue - (Purchase + Delivery + Confirmation) - Ad Cost
        // Note: Revenue here is already (totalSellingPrice - deliveryFeesCharged)
        const profit = revenue - purchaseCost - deliveryCost - confirmationCost - adCost
        
        const averageOrderValue = deliveredOrdersCount > 0 ? revenue / deliveredOrdersCount : 0
        const deliveredRate = ordersCount > 0 ? (deliveredOrdersCount / ordersCount) * 100 : 0
        const roas = adCost > 0 ? revenue / adCost : 0
        const cpl = ordersCount > 0 ? adCost / ordersCount : 0
        const cpa = deliveredOrdersCount > 0 ? adCost / deliveredOrdersCount : 0
        const marginRate = revenue > 0 ? (profit / revenue) * 100 : 0

        return {
          orders: ordersCount,
          deliveredOrders: deliveredOrdersCount,
          revenue,
          purchaseCost,
          adSpend: effectiveAdSpend,
          adCost,
          deliveryCost,
          confirmationCost,
          profit,
          averageOrderValue,
          deliveredRate,
          cpl,
          cpa,
          roas,
          marginRate,
        }

      }

      const current = await fetchMetrics(periodRange)
      const previous = await fetchMetrics(previousRange)
      const currentCharges = current.purchaseCost + current.deliveryCost + current.confirmationCost
      const previousCharges = previous.purchaseCost + previous.deliveryCost + previous.confirmationCost

      return {
        ...current,
        changes: {
          orders: calcPctChange(current.orders, previous.orders),
          deliveredOrders: calcPctChange(current.deliveredOrders, previous.deliveredOrders),
          revenue: calcPctChange(current.revenue, previous.revenue),
          charges: calcPctChange(currentCharges, previousCharges),
          adSpend: calcPctChange(current.adSpend, previous.adSpend),
          adCost: calcPctChange(current.adCost, previous.adCost),
          profit: calcPctChange(current.profit, previous.profit),
          deliveryCost: calcPctChange(current.deliveryCost, previous.deliveryCost),
          cpl: calcPctChange(current.cpl, previous.cpl),
          cpa: calcPctChange(current.cpa, previous.cpa),
          confirmationCost: calcPctChange(current.confirmationCost, previous.confirmationCost),
          roas: calcPctChange(current.roas, previous.roas),
          marginRate: calcPctChange(current.marginRate, previous.marginRate),
        },
      }
    },
  })


  const primaryKpis = [
    {
      title: 'Commandes',
      value: kpiData ? kpiData.orders.toLocaleString() : '0',
      rawChange: kpiData?.changes?.orders || 0,
      change: formatChange(kpiData?.changes?.orders || 0),
      trend: (kpiData?.changes?.orders || 0) >= 0 ? 'up' as const : 'down' as const,
      icon: ShoppingCart,
      color: 'bg-blue-500',
    },
    {
      title: 'Commandes livrées',
      value: kpiData ? kpiData.deliveredOrders.toLocaleString() : '0',
      rawChange: kpiData?.changes?.deliveredOrders || 0,
      change: formatChange(kpiData?.changes?.deliveredOrders || 0),
      trend: (kpiData?.changes?.deliveredOrders || 0) >= 0 ? 'up' as const : 'down' as const,
      icon: Truck,
      color: 'bg-emerald-500',
    },
    {
      title: 'Chiffre d\'affaires',
      value: kpiData ? formatCurrency(kpiData.revenue) : '0 MAD',
      rawChange: kpiData?.changes?.revenue || 0,
      change: formatChange(kpiData?.changes?.revenue || 0),
      trend: (kpiData?.changes?.revenue || 0) >= 0 ? 'up' as const : 'down' as const,
      icon: DollarSign,
      color: 'bg-green-500',
    },
    {
      title: 'Charges',
      value: kpiData ? formatCurrency((kpiData.purchaseCost || 0) + (kpiData.deliveryCost || 0) + (kpiData.confirmationCost || 0)) : '0 MAD',
      rawChange: kpiData?.changes?.charges || 0,
      change: formatChange(kpiData?.changes?.charges || 0),
      trend: (kpiData?.changes?.charges || 0) >= 0 ? 'up' as const : 'down' as const,
      infoText: 'Charges = Coût d’achat produit + Livraison + Confirmation (commandes livrées uniquement).',
      icon: Package,
      color: 'bg-yellow-500',
    },
    {
      title: 'Coût publicité',
      value: kpiData ? formatCurrency(kpiData.adCost) : '0 MAD',
      rawChange: kpiData?.changes?.adCost || 0,
      change: formatChange(kpiData?.changes?.adCost || 0),
      trend: (kpiData?.changes?.adCost || 0) >= 0 ? 'up' as const : 'down' as const,
      icon: Target,
      color: 'bg-purple-500',
    },
    {
      title: 'Profit',
      value: kpiData ? formatCurrency(kpiData.profit) : '0 MAD',
      rawChange: kpiData?.changes?.profit || 0,
      change: formatChange(kpiData?.changes?.profit || 0),
      trend: (kpiData?.changes?.profit || 0) >= 0 ? 'up' as const : 'down' as const,
      icon: TrendingUp,
      color: 'bg-emerald-500',
    },
  ]

  const marketingKpis = [
    {
      title: 'Dépense publicitaire',
      value: kpiData ? formatCurrency(kpiData.adSpend) : '0 MAD',
      rawChange: kpiData?.changes?.adSpend || 0,
      change: formatChange(kpiData?.changes?.adSpend || 0),
      trend: (kpiData?.changes?.adSpend || 0) >= 0 ? 'up' as const : 'down' as const,
      icon: Target,
      color: 'bg-indigo-500',
    },
    {
      title: 'CPL moyen (Coût par lead)',
      value: kpiData ? formatCurrency(kpiData.cpl) : '0 MAD',
      rawChange: kpiData?.changes?.cpl || 0,
      change: formatChange(kpiData?.changes?.cpl || 0),
      trend: (kpiData?.changes?.cpl || 0) >= 0 ? 'up' as const : 'down' as const,
      invertColor: true,
      icon: Target,
      color: 'bg-blue-500',
    },
    {
      title: 'CPA moyen (Coût par achat)',
      value: kpiData ? formatCurrency(kpiData.cpa) : '0 MAD',
      rawChange: kpiData?.changes?.cpa || 0,
      change: formatChange(kpiData?.changes?.cpa || 0),
      trend: (kpiData?.changes?.cpa || 0) >= 0 ? 'up' as const : 'down' as const,
      invertColor: true,
      icon: Target,
      color: 'bg-green-500',
    },
    {
      title: 'ROAS',
      value: kpiData ? `${kpiData.roas.toFixed(2)}x` : '0x',
      rawChange: kpiData?.changes?.roas || 0,
      change: formatChange(kpiData?.changes?.roas || 0),
      trend: (kpiData?.changes?.roas || 0) >= 0 ? 'up' as const : 'down' as const,
      icon: Target,
      color: 'bg-fuchsia-500',
    },
  ]

  if (isLoading) {
    return (
      <div className="space-y-6">
        {variant === 'primary' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            {primaryKpis.map((kpi) => {
              const Icon = kpi.icon
              return (
                <div
                  key={kpi.title}
              className="bg-card rounded-xl shadow border border-border p-5 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center justify-between">
                    <div className={`${kpi.color} p-2 rounded-lg`}>
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    <div className="animate-pulse h-4 w-10 bg-secondary dark:bg-gray-700 rounded"></div>
                  </div>
                  <div className="mt-4">
                    <div className="animate-pulse h-8 w-24 bg-secondary dark:bg-gray-700 rounded mb-2"></div>
                    <div className="text-sm text-muted-foreground dark:text-muted-foreground mt-1">{kpi.title}</div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
      <div className="bg-card rounded-xl shadow p-4">
            <div className="mb-3">
              <h3 className="text-lg font-semibold text-foreground dark:text-gray-100">Performance marketing</h3>
            </div>
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {marketingKpis.map((kpi) => {
            const Icon = kpi.icon
            return (
              <div key={kpi.title} className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div className={`${kpi.color} p-2 rounded-lg`}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <div className="animate-pulse h-3 w-10 bg-secondary dark:bg-gray-700 rounded"></div>
                </div>
                <div className="mt-3">
                  <div className="animate-pulse h-6 w-20 bg-secondary dark:bg-gray-700 rounded mb-2"></div>
                  <div className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">{kpi.title}</div>
                </div>
              </div>
            )
          })}
        </div>
            <div className="mt-4">
              <AdsCostChart />
            </div>
          </div>
        )}
      </div>
    )
  }

  if (variant === 'marketing') {
    return (
      <div className="bg-card rounded-xl shadow p-4">
        <div className="mb-3">
          <h3 className="text-lg font-semibold text-foreground dark:text-gray-100">Performance marketing</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {marketingKpis.map((kpi) => {
            const Icon = kpi.icon
            return (
              <div key={kpi.title} className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div className={`${kpi.color} p-2 rounded-lg`}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  {shouldShowChange(kpi.rawChange) ? (
                    <div className={`flex items-center text-xs ${kpi.trend === 'up' ? (kpi.invertColor ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400') : (kpi.invertColor ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}`}>
                      {kpi.trend === 'up' ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                      {kpi.change}
                    </div>
                  ) : (
                    <div className="w-10" />
                  )}
                </div>
                <div className="mt-3">
                  <div className="text-base sm:text-xl font-bold text-foreground dark:text-gray-100">{kpi.value}</div>
                  <div className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">{kpi.title}</div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-4">
          <AdsCostChart />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {primaryKpis.map((kpi) => {
          const Icon = kpi.icon
          return (
            <div
              key={kpi.title}
              className="bg-card rounded-xl shadow border border-border p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div className={`${kpi.color} p-2 rounded-lg`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                {shouldShowChange(kpi.rawChange) ? (
                  <div className={`flex items-center text-xs opacity-60 ${kpi.trend === 'up' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {kpi.trend === 'up' ? (
                      <TrendingUp className="w-4 h-4 mr-1" />
                    ) : (
                      <TrendingDown className="w-4 h-4 mr-1" />
                    )}
                    {kpi.change}
                  </div>
                ) : (
                  <div className="w-12" />
                )}
              </div>
              <div className="mt-4">
                <div className="text-lg sm:text-2xl font-bold text-foreground dark:text-gray-100">{kpi.value}</div>
                <div className="text-sm text-muted-foreground dark:text-muted-foreground mt-1 flex items-center gap-1">
                  <span>{kpi.title}</span>
                  {kpi.infoText && (
                    <div className="relative group">
                      <button type="button" className="text-muted-foreground hover:text-foreground dark:text-gray-300 dark:hover:text-muted-foreground" aria-label="Info charges">
                        <Info className="w-3.5 h-3.5" />
                      </button>
                      <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 sm:w-64 rounded-md bg-gray-800 text-white text-[11px] leading-4 p-2 shadow-lg z-20">
                        {kpi.infoText}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
