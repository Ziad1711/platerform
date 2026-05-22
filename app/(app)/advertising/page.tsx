'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useStore } from '@/lib/store-context'
import { formatCurrency } from '@/lib/utils'
import StoreSelector from '@/components/dashboard/store-selector'
import AdsKpiGrid from '@/components/advertising/ads-kpi-grid'
import AdsTimeSeries from '@/components/advertising/ads-time-series'
import { JisraMark } from '@/components/logo'
import {
  BarChart3,
  Download,
  Loader2,
} from 'lucide-react'

type AdsMetrics = {
  summary: {
    totalSpend: number
    totalSpendConverted: number
    totalImpressions: number
    totalClicks: number
    totalReach: number
    totalConversions: number
    totalConversionValue: number
    totalConversionValueConverted: number
    totalPurchases: number
    totalAddToCart: number
    totalInitiateCheckout: number
    avgCTR: number
    avgCPC: number
    avgCPM: number
    avgFrequency: number
    roas: number
    daysWithData: number
  }
  timeSeries: Array<{
    date: string
    spend: number
    impressions: number
    clicks: number
    reach: number
    conversions: number
    conversionValue: number
    purchases: number
    ctr: number
    cpc: number
    cpm: number
  }>
  byProduct: Array<{
    productId: string
    productName: string
    spend: number
    impressions: number
    clicks: number
    conversions: number
    conversionValue: number
    purchases: number
    roas: number
    cpc: number
  }>
  byCampaign: Array<{
    campaignId: string
    campaignName: string
    productId: string
    productName: string
    spend: number
    impressions: number
    clicks: number
    ctr: number
    conversions: number
    conversionValue: number
    purchases: number
    cpc: number
    cpm: number
    days: number
    roas: number
  }>
}

export default function AdvertisingPage() {
  const { currentStoreId } = useStore()
  const [selectedProductId, setSelectedProductId] = useState<string>('')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-01-01`
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])
  const [sortBy, setSortBy] = useState<'spend' | 'roas' | 'conversions'>('spend')
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day')

  const { data: metrics, isLoading } = useQuery<AdsMetrics>({
    queryKey: ['ads-metrics', currentStoreId, selectedProductId, dateFrom, dateTo, groupBy],
    enabled: !!currentStoreId,
    queryFn: async () => {
      const params = new URLSearchParams({
        storeId: currentStoreId!,
        from: dateFrom,
        to: dateTo,
        groupBy,
      })
      if (selectedProductId) params.set('productId', selectedProductId)

      const res = await fetch(`/api/ads/metrics?${params}`)
      if (!res.ok) throw new Error('Failed to fetch ads metrics')
      return res.json()
    },
  })

  const { data: products } = useQuery({
    queryKey: ['ads-products', currentStoreId],
    enabled: !!currentStoreId,
    queryFn: async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('products')
        .select('id, name')
        .eq('store_id', currentStoreId!)
        .order('name')
      return data || []
    },
  })

  const sortedCampaigns = useMemo(() => {
    if (!metrics?.byCampaign) return []
    return [...metrics.byCampaign].sort((a, b) => {
      if (sortBy === 'roas') return b.roas - a.roas
      if (sortBy === 'conversions') return b.purchases - a.purchases
      return b.spend - a.spend
    })
  }, [metrics?.byCampaign, sortBy])

  const sortedProducts = useMemo(() => {
    if (!metrics?.byProduct) return []
    return [...metrics.byProduct].sort((a, b) => {
      if (sortBy === 'roas') return b.roas - a.roas
      if (sortBy === 'conversions') return b.purchases - a.purchases
      return b.spend - a.spend
    })
  }, [metrics?.byProduct, sortBy])

  const exportCSV = () => {
    if (!metrics?.byCampaign) return
    const headers = ['Campagne', 'Produit', 'Dépenses', 'Impressions', 'Clics', 'CTR', 'Conversions', 'Valeur Conv.', 'ROAS', 'CPC', 'CPM']
    const rows = metrics.byCampaign.map((c) => [
      c.campaignName,
      c.productName,
      c.spend.toFixed(2),
      c.impressions,
      c.clicks,
      (c.ctr).toFixed(2) + '%',
      c.purchases,
      c.conversionValue.toFixed(2),
      c.roas.toFixed(2),
      c.cpc.toFixed(4),
      c.cpm.toFixed(4),
    ])
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ads-metrics-${dateFrom}-${dateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col items-center sm:items-start gap-1">
        <div className="flex items-center gap-2">
          <JisraMark size={28} />
          <span className="text-lg font-bold text-[#1fa971] bg-[#1fa971]/10 px-3 py-1 rounded-full">
            Publicité
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Analyse des performances des campagnes Facebook Ads
        </p>
      </div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="hidden">
          <h1 className="text-2xl font-bold">Publicité</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Analyse des performances des campagnes Facebook Ads
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StoreSelector />
          <button
            onClick={exportCSV}
            disabled={!metrics}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Du</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:border-gray-600"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Au</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:border-gray-600"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Produit</label>
          <select
            value={selectedProductId}
            onChange={(e) => setSelectedProductId(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:border-gray-600"
          >
            <option value="">Tous les produits</option>
            {(products || []).map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Granularité</label>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as any)}
            className="border rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:border-gray-600"
          >
            <option value="day">Jour</option>
            <option value="week">Semaine</option>
            <option value="month">Mois</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Trier par</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="border rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:border-gray-600"
          >
            <option value="spend">Dépenses</option>
            <option value="roas">ROAS</option>
            <option value="conversions">Conversions</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : !metrics ? (
        <div className="text-center py-20 text-gray-500">
          <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Sélectionnez un store pour voir les métriques</p>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <AdsKpiGrid summary={metrics.summary} />

          {/* Time Series Chart */}
          <AdsTimeSeries data={metrics.timeSeries} />

          {/* Performance by Campaign */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold mb-4">Performance par campagne</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-2 px-3">Campagne</th>
                    <th className="text-left py-2 px-3">Produit</th>
                    <th className="text-right py-2 px-3">Dépenses</th>
                    <th className="text-right py-2 px-3">Impressions</th>
                    <th className="text-right py-2 px-3">Clics</th>
                    <th className="text-right py-2 px-3">CTR</th>
                    <th className="text-right py-2 px-3">Conversions</th>
                    <th className="text-right py-2 px-3">Valeur Conv.</th>
                    <th className="text-right py-2 px-3">ROAS</th>
                    <th className="text-right py-2 px-3">CPC</th>
                    <th className="text-right py-2 px-3">Jours</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCampaigns.map((camp) => (
                    <tr key={camp.campaignId} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="py-2 px-3 font-medium">{camp.campaignName}</td>
                      <td className="py-2 px-3 text-gray-600 dark:text-gray-400">{camp.productName}</td>
                      <td className="text-right py-2 px-3">{formatCurrency(camp.spend)}</td>
                      <td className="text-right py-2 px-3">{camp.impressions.toLocaleString()}</td>
                      <td className="text-right py-2 px-3">{camp.clicks.toLocaleString()}</td>
                      <td className="text-right py-2 px-3">{(camp.ctr).toFixed(2)}%</td>
                      <td className="text-right py-2 px-3">{camp.purchases}</td>
                      <td className="text-right py-2 px-3">{formatCurrency(camp.conversionValue)}</td>
                      <td className="text-right py-2 px-3 font-semibold">{camp.roas.toFixed(2)}x</td>
                      <td className="text-right py-2 px-3">{formatCurrency(camp.cpc)}</td>
                      <td className="text-right py-2 px-3 text-gray-500">{camp.days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Performance by Product */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold mb-4">Performance par produit</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-2 px-3">Produit</th>
                    <th className="text-right py-2 px-3">Dépenses</th>
                    <th className="text-right py-2 px-3">Impressions</th>
                    <th className="text-right py-2 px-3">Clics</th>
                    <th className="text-right py-2 px-3">Conversions</th>
                    <th className="text-right py-2 px-3">Valeur Conv.</th>
                    <th className="text-right py-2 px-3">ROAS</th>
                    <th className="text-right py-2 px-3">CPC</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedProducts.map((prod) => (
                    <tr key={prod.productId} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="py-2 px-3 font-medium">{prod.productName}</td>
                      <td className="text-right py-2 px-3">{formatCurrency(prod.spend)}</td>
                      <td className="text-right py-2 px-3">{prod.impressions.toLocaleString()}</td>
                      <td className="text-right py-2 px-3">{prod.clicks.toLocaleString()}</td>
                      <td className="text-right py-2 px-3">{prod.purchases}</td>
                      <td className="text-right py-2 px-3">{formatCurrency(prod.conversionValue)}</td>
                      <td className="text-right py-2 px-3 font-semibold">{prod.roas.toFixed(2)}x</td>
                      <td className="text-right py-2 px-3">{formatCurrency(prod.cpc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
