import { getServerUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import KpiCards from '@/components/dashboard/kpi-cards'
import RevenueChart from '@/components/dashboard/revenue-chart'
import TopProducts from '@/components/dashboard/top-products'
import RecentOrders from '@/components/dashboard/recent-orders'
import CityPerformance from '@/components/dashboard/city-performance'
import ConfirmationPerformance from '@/components/dashboard/confirmation-performance'
import PeriodFilter from '@/components/dashboard/period-filter'
import StoreSelector from '@/components/dashboard/store-selector'
import { JisraMark } from '@/components/logo'

export default async function DashboardPage() {
  const user = await getServerUser()

  if (!user) {
    redirect('/login')
  }


  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-center sm:items-center justify-between gap-4">
        <div className="text-center sm:text-left flex flex-col items-center sm:items-start gap-1">
          <div className="flex items-center gap-2">
            <JisraMark size={28} />
            <span className="text-lg font-bold text-[#1fa971] bg-[#1fa971]/10 px-3 py-1 rounded-full">
              Dashboard
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Vue d'ensemble de votre activité
          </p>
        </div>
        <div className="flex items-center justify-center sm:justify-start gap-3 w-full sm:w-auto">
          <StoreSelector />
          <PeriodFilter />
        </div>
      </div>

      {/* KPIs */}
      <div className="animate-fade-in-up animate-delay-100">
        <KpiCards />
      </div>

      {/* Revenue Chart */}
      <div className="animate-fade-in-up animate-delay-200">
        <RevenueChart />
      </div>

      {/* Marketing KPIs */}
      <div className="animate-fade-in-up animate-delay-300">
        <KpiCards variant="marketing" />
      </div>

      {/* Grid: Top Products + City Performance */}
      <div className="grid grid-cols-1 xl:grid-cols-[3fr_1fr] gap-6 animate-fade-in-up animate-delay-400">
        <TopProducts />
        <CityPerformance />
      </div>

      {/* Confirmation Performance */}
      <div className="animate-fade-in-up animate-delay-500">
        <ConfirmationPerformance />
      </div>

      {/* Recent Orders */}
      <div className="animate-fade-in-up animate-delay-500">
        <RecentOrders />
      </div>
    </div>
  )
}
