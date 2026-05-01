'use client'

import {
  TrendingUp,
  MousePointerClick,
  Eye,
  Target,
  DollarSign,
  BarChart3,
  ShoppingCart,
  Percent,
} from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

interface AdsSummary {
  totalSpendConverted: number
  totalConversionValue: number
  totalConversionValueConverted: number
  totalImpressions: number
  totalClicks: number
  totalReach: number
  totalPurchases: number
  totalAddToCart: number
  avgCTR: number
  avgCPC: number
  avgCPM: number
  avgFrequency: number
  roas: number
  daysWithData: number
}

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
}: {
  title: string
  value: string
  subtitle?: string
  icon: React.ElementType
  color: string
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          {subtitle && (
            <p className="text-xs text-gray-400 mt-1">{subtitle}</p>
          )}
        </div>
        <div className={`p-3 rounded-lg ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  )
}

export default function AdsKpiGrid({ summary }: { summary: AdsSummary }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiCard
        title="Dépenses"
        value={formatCurrency(summary.totalSpendConverted)}
        subtitle={`${summary.daysWithData} périodes`}
        icon={DollarSign}
        color="bg-blue-500"
      />
      <KpiCard
        title="ROAS"
        value={summary.roas.toFixed(2) + 'x'}
        subtitle={`Valeur conv. ${formatCurrency(summary.totalConversionValueConverted)}`}
        icon={TrendingUp}
        color="bg-green-500"
      />
      <KpiCard
        title="CTR"
        value={(summary.avgCTR).toFixed(2) + '%'}
        subtitle={`${summary.totalClicks} clics`}
        icon={MousePointerClick}
        color="bg-purple-500"
      />
      <KpiCard
        title="Conversions"
        value={summary.totalPurchases.toString()}
        subtitle={`${summary.totalAddToCart} ajouts panier`}
        icon={ShoppingCart}
        color="bg-orange-500"
      />
      <KpiCard
        title="Impressions"
        value={summary.totalImpressions.toLocaleString()}
        subtitle={`Reach: ${summary.totalReach.toLocaleString()}`}
        icon={Eye}
        color="bg-cyan-500"
      />
      <KpiCard
        title="CPC"
        value={formatCurrency(summary.avgCPC)}
        subtitle="Coût par clic"
        icon={Target}
        color="bg-red-500"
      />
      <KpiCard
        title="CPM"
        value={formatCurrency(summary.avgCPM)}
        subtitle="Coût pour 1000 impressions"
        icon={BarChart3}
        color="bg-indigo-500"
      />
      <KpiCard
        title="Fréquence"
        value={summary.avgFrequency.toFixed(2)}
        subtitle="Impressions / Reach"
        icon={Percent}
        color="bg-pink-500"
      />
    </div>
  )
}
