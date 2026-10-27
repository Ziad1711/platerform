import { getServerUserResult } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import KpiCards from '@/components/dashboard/kpi-cards'
import RevenueChart from '@/components/dashboard/revenue-chart'
import TopProducts from '@/components/dashboard/top-products'
import OrderTimePerformance from '@/components/dashboard/order-time-performance'
import RecentOrders from '@/components/dashboard/recent-orders'
import CityPerformance from '@/components/dashboard/city-performance'
import ConfirmationPerformance from '@/components/dashboard/confirmation-performance'
import DeferredSection from '@/components/dashboard/deferred-section'
import PeriodFilter from '@/components/dashboard/period-filter'
import StoreSelector from '@/components/dashboard/store-selector'
import { JisraMark } from '@/components/logo'
import { kpiReaderV5Enabled } from '@/lib/dashboard/kpi-reader-flag'
import { KpiRolloutProbe, KpiRolloutProvider } from '@/lib/dashboard/use-kpi-rollout'
import { loadRolloutSeed } from '@/lib/dashboard/rollout-seed.server'

export default async function DashboardPage() {
  const { user, authUnavailable } = await getServerUserResult()
  // Autorisation serveur : le mode effectif reste décidé par la configuration
  // opérationnelle et vaut legacy par défaut.
  const rolloutEnabled = kpiReaderV5Enabled()

  // Le layout protégé affiche normalement déjà l'état d'indisponibilité ; ce
  // repli couvre le cas où seul ce contrôle échoue (panne intermittente) :
  // afficher un écran de réessai plutôt qu'un contenu vide.
  if (authUnavailable) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="mx-auto w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-lg">
          <h1 className="text-lg font-semibold">
            Service d&apos;authentification indisponible
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Impossible de vérifier votre session pour le moment. Veuillez réessayer
            dans quelques instants.
          </p>
          <a
            href="/login"
            className="mt-5 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Réessayer
          </a>
        </div>
      </div>
    )
  }

  if (!user) {
    redirect('/login')
  }

  // Anticipation NON bloquante : la lecture de configuration démarre pendant le
  // rendu serveur et sa promesse est transmise au navigateur. Le rendu de la
  // structure n'attend jamais cette lecture, et aucune décision n'est prise
  // avant les contrôles existants côté client.
  const rolloutSeed = rolloutEnabled && user ? loadRolloutSeed(user.id) : null

  return (
    <KpiRolloutProvider enabled={rolloutEnabled} initialRollout={rolloutSeed}>
    <KpiRolloutProbe />
    <div className="space-y-6 pt-2 sm:pt-0 animate-fade-in">

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
          <PeriodFilter defaultPeriod="today" />
        </div>
      </div>

      {/* KPIs — priorité réseau : seuls ces blocs lisent au montage initial.
          Le premier commit ne contient que l'en-tête et les cartes, ce qui
          laisse les lectures KPI partir avant toute lecture secondaire. */}
      <div className="animate-fade-in-up animate-delay-100">
        <KpiCards />
      </div>

      {/* Graphique de performance du business (lecteur V5 V2) : secondaire.
          Monté dès qu'il approche du viewport, jamais avant les cartes. */}
      <DeferredSection
        label="Chargement du graphique de performance du business"
        minHeight={420}
        className="animate-fade-in-up animate-delay-200"
      >
        <RevenueChart />
      </DeferredSection>

      {/* Marketing KPIs + graphique de coûts publicitaires */}
      <DeferredSection
        label="Chargement des indicateurs marketing"
        minHeight={380}
        className="animate-fade-in-up animate-delay-300"
      >
        <KpiCards variant="marketing" />
      </DeferredSection>

      {/* Grid: Top Products + City Performance (un RPC par boutique chacun) */}
      <DeferredSection
        label="Chargement des performances produits et villes"
        minHeight={360}
        className="animate-fade-in-up animate-delay-400"
      >
        <div className="grid grid-cols-1 xl:grid-cols-[3fr_1fr] gap-6">
          <TopProducts />
          <CityPerformance />
        </div>
      </DeferredSection>

      {/* Order time performance (best days & hours) */}
      <DeferredSection
        label="Chargement des meilleurs jours et heures"
        minHeight={340}
        className="animate-fade-in-up animate-delay-400"
      >
        <OrderTimePerformance />
      </DeferredSection>

      {/* Confirmation Performance */}
      <DeferredSection
        label="Chargement des performances de confirmation"
        minHeight={320}
        className="animate-fade-in-up animate-delay-500"
      >
        <ConfirmationPerformance />
      </DeferredSection>

      {/* Recent Orders */}
      <DeferredSection
        label="Chargement des commandes récentes"
        minHeight={320}
        className="animate-fade-in-up animate-delay-500"
      >
        <RecentOrders />
      </DeferredSection>
    </div>
    </KpiRolloutProvider>
  )
}
