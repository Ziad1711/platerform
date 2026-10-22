'use client'

import { useMemo } from 'react'
import { TrendingUp, TrendingDown, DollarSign, ShoppingCart, Target, Package, Truck, Info } from 'lucide-react'
import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'
import { DASHBOARD_ANALYTICS_STALE_MS } from '@/lib/dashboard/analytics-cache'
import { formatCurrency, formatNumber } from '@/lib/utils'
import AdsCostChart from '@/components/dashboard/ads-cost-chart'
import { businessRange, useKpiReader, KPI_REVISION_POLL_MS } from '@/lib/dashboard/use-kpi-reader'
import {
  businessRangeToInstants,
  legacyBusinessRange,
  previousBusinessPeriodRange,
  sameBusinessRange,
  type BusinessRange,
} from '@/lib/dashboard/business-time'
import { buildReaderScope } from '@/lib/dashboard/kpi-reader-mappers'
import type { KpiReaderMode } from '@/lib/dashboard/kpi-reader-flag'
import { useKpiReaderErrorTelemetry, useKpiRollout } from '@/lib/dashboard/use-kpi-rollout'


interface KpiData {
  financialAccess: boolean
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
  /** `null` : période précédente absente, incomplète ou non comparable. */
  changes: KpiChanges | null
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
  /** Override de test uniquement ; le mode normal vient du rollout serveur. */
  source?: KpiReaderMode
}

export default function KpiCards({ variant = 'primary', source }: KpiCardsProps) {
  const { currentStoreId, selectedPeriod, customStartDate, customEndDate, accessibleStoreIds, isStoresLoading, userId } = useStore()
  const rollout = useKpiRollout()
  const mode = source ?? rollout.mode
  const supabase = createClient()
  const legacyRange = legacyBusinessRange(selectedPeriod, customStartDate, customEndDate)
  const legacyPreviousRange = previousBusinessPeriodRange(selectedPeriod, legacyRange)

  const v5Enabled = mode === 'v5'
  const v5Range = businessRange(selectedPeriod, customStartDate, customEndDate)
  // Comparaison identique au dashboard legacy : mois/trimestre/année précédents
  // complets, et aucune comparaison pour « Toujours ».
  const v5PreviousRange = previousBusinessPeriodRange(selectedPeriod, v5Range)
  const v5ComparablePeriod = selectedPeriod !== 'all'
  const v5StoreIds = currentStoreId ? [currentStoreId] : null
  const boundary = `${userId ?? 'anonymous'}:${rollout.accessFingerprint}`

  const v5Current = useKpiReader({
    enabled: v5Enabled && !isStoresLoading,
    supabase,
    boundary,
    storeIds: v5StoreIds,
    from: v5Range.from,
    to: v5Range.to,
    // Un seul poller par dashboard : l'invalidation couvre toutes les clés V5.
    pollMs: variant === 'primary' ? KPI_REVISION_POLL_MS : 0,
  })
  const v5Previous = useKpiReader({
    enabled: v5Enabled && !isStoresLoading && v5ComparablePeriod,
    supabase,
    boundary,
    storeIds: v5StoreIds,
    from: v5PreviousRange.from,
    to: v5PreviousRange.to,
    pollMs: 0,
  })
  useKpiReaderErrorTelemetry(
    'kpi-cards',
    v5Enabled,
    v5Current.isError || v5Previous.isError,
  )

  // Comparabilité des périodes : mêmes totaux exploitables, aucune journée
  // sale/absente/incompatible de part et d'autre, et « Toujours » exclu
  // (borné à 365 jours, donc non comparable à une période précédente).
  const v5Comparable = useMemo(() => {
    if (!v5Enabled || !v5Current.data || !v5Previous.data) return false
    if (selectedPeriod === 'all') return false
    const current = buildReaderScope(v5Current.data)
    const previous = buildReaderScope(v5Previous.data)
    return Boolean(current.totals) && Boolean(previous.totals) && !current.incomplete && !previous.incomplete
  }, [v5Enabled, v5Current.data, v5Previous.data, selectedPeriod])

  const v5Result = useMemo<KpiResult | undefined>(() => {
    if (!v5Enabled || !v5Current.data) return undefined
    const current = buildReaderScope(v5Current.data)
    if (!current.totals) return undefined
    const previous = v5Previous.data ? buildReaderScope(v5Previous.data) : null

    const totals = current.totals as unknown as Record<string, unknown>
    const previousTotals = (previous?.totals ?? {}) as unknown as Record<string, unknown>
    const num = (value: unknown) => (value === undefined || value === null ? 0 : Number(value))
    const metric = (record: Record<string, unknown>, key: string) => num(record[key])

    const data: KpiData = {
      financialAccess: current.access === 'full',
      orders: metric(totals, 'orders_count'),
      deliveredOrders: metric(totals, 'delivered_count'),
      revenue: metric(totals, 'revenue'),
      purchaseCost: metric(totals, 'purchase_cost'),
      adSpend: metric(totals, 'ads_tracked') + metric(totals, 'ads_fallback'),
      adCost: metric(totals, 'ads_tracked') + metric(totals, 'ads_fallback'),
      deliveryCost: metric(totals, 'delivery_fee_cost'),
      confirmationCost: metric(totals, 'confirmation_cost'),
      profit: metric(totals, 'contribution_margin'),
      averageOrderValue: metric(totals, 'aov'),
      deliveredRate: metric(totals, 'delivery_rate'),
      cpl: metric(totals, 'cpl'),
      cpa: metric(totals, 'cpa'),
      roas: metric(totals, 'roas'),
      marginRate: metric(totals, 'margin_rate'),
    }

    const charges = data.purchaseCost + data.deliveryCost + data.confirmationCost
    const previousCharges =
      metric(previousTotals, 'purchase_cost') +
      metric(previousTotals, 'delivery_fee_cost') +
      metric(previousTotals, 'confirmation_cost')

    // Aucune variation si une des deux périodes n'est pas couverte ou si la
    // comparaison n'a pas de sens : « Toujours » est borné à 365 jours.
    const comparable = v5Comparable

    return {
      ...data,
      changes: comparable
        ? {
            orders: calcPctChange(data.orders, metric(previousTotals, 'orders_count')),
            deliveredOrders: calcPctChange(data.deliveredOrders, metric(previousTotals, 'delivered_count')),
            revenue: calcPctChange(data.revenue, metric(previousTotals, 'revenue')),
            charges: calcPctChange(charges, previousCharges),
            adSpend: calcPctChange(
              data.adSpend,
              metric(previousTotals, 'ads_tracked') + metric(previousTotals, 'ads_fallback'),
            ),
            adCost: calcPctChange(
              data.adCost,
              metric(previousTotals, 'ads_tracked') + metric(previousTotals, 'ads_fallback'),
            ),
            profit: calcPctChange(data.profit, metric(previousTotals, 'contribution_margin')),
            deliveryCost: calcPctChange(data.deliveryCost, metric(previousTotals, 'delivery_fee_cost')),
            cpl: calcPctChange(data.cpl, metric(previousTotals, 'cpl')),
            cpa: calcPctChange(data.cpa, metric(previousTotals, 'cpa')),
            confirmationCost: calcPctChange(
              data.confirmationCost,
              metric(previousTotals, 'confirmation_cost'),
            ),
            roas: calcPctChange(data.roas, metric(previousTotals, 'roas')),
            marginRate: calcPctChange(data.marginRate, metric(previousTotals, 'margin_rate')),
          }
        : null,
    }
  }, [v5Enabled, v5Current.data, v5Previous.data, v5Comparable])

  const v5Scope = useMemo(
    () => (v5Current.data ? buildReaderScope(v5Current.data) : null),
    [v5Current.data],
  )
  const v5Access = v5Scope?.access ?? null
  const v5Coverage = v5Scope?.coverage ?? null
  const v5Mixed = v5Scope?.mixed ?? false
  const v5Notice = useMemo(() => {
    if (!v5Enabled) return null
    const notes: string[] = []
    if (selectedPeriod === 'all') {
      notes.push('Variations non calculées sur « Toujours ».')
    } else if (!v5Comparable) {
      notes.push('Comparaison indisponible pour cette période.')
    }
    if (v5Coverage) {
      const dirty = v5Coverage.days_dirty
      const incomplete = v5Coverage.days_missing + v5Coverage.days_incompatible
      // Un total partiel ne doit jamais être présenté comme complet, mais le
      // détail des partitions reste dans les outils internes. La cause affichée
      // reste exacte : actualisation en cours ≠ journée réellement absente.
      if (dirty > 0 && incomplete > 0) {
        notes.push(
          'Données partielles : certains jours sont en cours d’actualisation et d’autres sont incomplets. Ces journées sont exclues des totaux.',
        )
      } else if (dirty > 0) {
        notes.push('Données en cours d’actualisation : ces journées sont exclues des totaux.')
      } else if (incomplete > 0) {
        notes.push('Données incomplètes : certains jours sont exclus des totaux.')
      }
    }
    return notes.length > 0 ? notes.join(' ') : null
  }, [v5Enabled, v5Coverage, v5Comparable, v5Previous.isError, v5Previous.data, selectedPeriod])



  const { data: legacyData, isLoading: legacyLoading } = useQuery<KpiResult>({
    queryKey: ['dashboard-kpis', currentStoreId, selectedPeriod, customStartDate, customEndDate, accessibleStoreIds, mode, rollout.accessFingerprint],
    enabled: !isStoresLoading && mode !== 'v5' && rollout.resolved,
    staleTime: DASHBOARD_ANALYTICS_STALE_MS,
    queryFn: async () => {
      const fetchMetrics = async (range: BusinessRange): Promise<KpiData> => {
        const storeIds = currentStoreId ? [currentStoreId] : accessibleStoreIds
        const { start, end } = businessRangeToInstants(range)

        if (storeIds.length === 0) {
          return {
            financialAccess: false,
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

        // Lot 1 (O1) : le CA des cartes provient de `rpc_dashboard_kpi_metrics`.
        // L'appel `rpc_dashboard_top_products` ne servait qu'à le recalculer
        // (résultat identique : 7 boutiques x 3 périodes vérifiées en base), et il
        // reste utilisé par le bloc Produits.
        const results = await Promise.all(
          storeIds.map(async (storeId) => {
            const { data, error } = await supabase.rpc('rpc_dashboard_kpi_metrics', {
              p_store_id: storeId,
              p_start_date: start.toISOString(),
              p_end_date: end.toISOString(),
            })

            if (error) throw error

            return (data?.[0] || {}) as {
              orders_count?: number
              delivered_count?: number
              revenue?: number
              purchase_cost?: number | null
              ad_spend?: number
              ad_cost_allocated?: number
              delivery_cost?: number | null
              confirmation_cost?: number | null
            }
          })
        )

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

        const financialAccess = results.every((row) =>
          row.purchase_cost !== null &&
          row.delivery_cost !== null &&
          row.confirmation_cost !== null,
        )
        const aggregated = results.reduce<AggregatedRow>((acc, row) => {
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
        // Lot 1 (O1) : CA = valeur de `rpc_dashboard_kpi_metrics`. Identique à la
        // somme des revenus produits (mêmes lignes livrées), sans second calcul.
        const revenue = aggregated.revenue
        
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
          financialAccess,
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

      // Lot 1 (O2) : une période précédente strictement identique à la période
      // courante ne justifie pas un second appel réseau ; les variations restent
      // calculées sur les mêmes valeurs.
      const current = await fetchMetrics(legacyRange)
      const previous = sameBusinessRange(legacyPreviousRange, legacyRange)
        ? current
        : await fetchMetrics(legacyPreviousRange)
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


  const kpiData = v5Enabled ? v5Result : legacyData
  const isLoading = v5Enabled
    ? isStoresLoading || v5Current.isLoading
    : isStoresLoading || legacyLoading || !rollout.resolved
  // Accès commercial : aucun coût, marge ni profit ne doit être affiché.
  const showCosts = v5Enabled ? v5Access === 'full' : kpiData?.financialAccess === true
  const primaryKpis = [
    {
      title: 'Commandes',
      value: kpiData ? formatNumber(kpiData.orders) : '—',
      rawChange: kpiData?.changes?.orders || 0,
      change: formatChange(kpiData?.changes?.orders || 0),
      trend: (kpiData?.changes?.orders || 0) >= 0 ? 'up' as const : 'down' as const,
      icon: ShoppingCart,
      color: 'bg-blue-500',
    },
    {
      title: 'Commandes livrées',
      value: kpiData ? formatNumber(kpiData.deliveredOrders) : '—',
      rawChange: kpiData?.changes?.deliveredOrders || 0,
      change: formatChange(kpiData?.changes?.deliveredOrders || 0),
      trend: (kpiData?.changes?.deliveredOrders || 0) >= 0 ? 'up' as const : 'down' as const,
      icon: Truck,
      color: 'bg-emerald-500',
    },
    {
      title: 'Chiffre d\'affaires',
      value: kpiData ? formatCurrency(kpiData.revenue) : '—',
      rawChange: kpiData?.changes?.revenue || 0,
      change: formatChange(kpiData?.changes?.revenue || 0),
      trend: (kpiData?.changes?.revenue || 0) >= 0 ? 'up' as const : 'down' as const,
      icon: DollarSign,
      color: 'bg-green-500',
    },
    {
      title: 'Charges',
      value: showCosts && kpiData ? formatCurrency((kpiData.purchaseCost || 0) + (kpiData.deliveryCost || 0) + (kpiData.confirmationCost || 0)) : 'Non autorisé',
      rawChange: kpiData?.changes?.charges || 0,
      change: formatChange(kpiData?.changes?.charges || 0),
      trend: (kpiData?.changes?.charges || 0) >= 0 ? 'up' as const : 'down' as const,
      infoText: 'Charges = Coût d’achat produit + Livraison + Confirmation (commandes livrées uniquement).',
      icon: Package,
      color: 'bg-yellow-500',
    },
    {
      title: 'Coût publicité',
      value: kpiData ? formatCurrency(kpiData.adCost) : '—',
      rawChange: kpiData?.changes?.adCost || 0,
      change: formatChange(kpiData?.changes?.adCost || 0),
      trend: (kpiData?.changes?.adCost || 0) >= 0 ? 'up' as const : 'down' as const,
      icon: Target,
      color: 'bg-purple-500',
    },
    {
      title: 'Profit (partiel)',
      value: showCosts && kpiData ? formatCurrency(kpiData.profit) : 'Non autorisé',
      rawChange: kpiData?.changes?.profit || 0,
      change: formatChange(kpiData?.changes?.profit || 0),
      trend: (kpiData?.changes?.profit || 0) >= 0 ? 'up' as const : 'down' as const,
      infoText: 'Résultat partiel : ventes livrées − coût produit − livraison − confirmation − publicité, sans les autres charges. Le résultat opérationnel complet est dans Finances.',
      icon: TrendingUp,
      color: 'bg-emerald-500',
    },
  ]

  const marketingKpis = [
    {
      title: 'Dépense publicitaire',
      value: kpiData ? formatCurrency(kpiData.adSpend) : '—',
      rawChange: kpiData?.changes?.adSpend || 0,
      change: formatChange(kpiData?.changes?.adSpend || 0),
      trend: (kpiData?.changes?.adSpend || 0) >= 0 ? 'up' as const : 'down' as const,
      icon: Target,
      color: 'bg-indigo-500',
    },
    {
      title: 'CPL moyen (Coût par lead)',
      value: kpiData ? formatCurrency(kpiData.cpl) : '—',
      rawChange: kpiData?.changes?.cpl || 0,
      change: formatChange(kpiData?.changes?.cpl || 0),
      trend: (kpiData?.changes?.cpl || 0) >= 0 ? 'up' as const : 'down' as const,
      invertColor: true,
      icon: Target,
      color: 'bg-blue-500',
    },
    {
      title: 'CPA moyen (Coût par achat)',
      value: kpiData ? formatCurrency(kpiData.cpa) : '—',
      rawChange: kpiData?.changes?.cpa || 0,
      change: formatChange(kpiData?.changes?.cpa || 0),
      trend: (kpiData?.changes?.cpa || 0) >= 0 ? 'up' as const : 'down' as const,
      invertColor: true,
      icon: Target,
      color: 'bg-green-500',
    },
    {
      title: 'ROAS',
      value: kpiData ? `${kpiData.roas.toFixed(2)}x` : '—',
      rawChange: kpiData?.changes?.roas || 0,
      change: formatChange(kpiData?.changes?.roas || 0),
      trend: (kpiData?.changes?.roas || 0) >= 0 ? 'up' as const : 'down' as const,
      icon: Target,
      color: 'bg-fuchsia-500',
    },
  ]

  // Multi-devises ou niveaux d'accès mixtes : aucun montant ne doit être additionné.
  if (v5Enabled && v5Mixed) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
        Plusieurs devises ou niveaux d&apos;accès sont concernés : les montants ne sont pas
        additionnés. Sélectionnez une boutique pour consulter ses KPI.
      </div>
    )
  }

  // Erreur de lecture V5 ou aucun total exploitable : jamais de zéro financier.
  if (v5Enabled && !isLoading && !v5Result) {
    return (
      <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
        {v5Current.isError
          ? 'KPI indisponibles : la lecture V5 a échoué. Aucun montant n’est affiché.'
          : 'KPI indisponibles : aucun total exploitable pour cette période. Aucun montant n’est affiché.'}
      </div>
    )
  }

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
              <AdsCostChart source={mode} />
            </div>
          </div>
        )}
      </div>
    )
  }

  if (variant === 'marketing') {
    return (
      <div className="bg-card rounded-xl shadow p-4">
        <span hidden data-kpi-financial-access={String(showCosts)} />
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
          <AdsCostChart source={mode} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <span hidden data-kpi-financial-access={String(showCosts)} />
      {v5Enabled && v5Notice && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          {v5Notice}
        </div>
      )}
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
                <div className="text-base sm:text-lg lg:text-xl font-bold text-foreground dark:text-gray-100">{kpi.value}</div>
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
