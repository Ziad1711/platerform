'use client'

import Sidebar from '@/components/dashboard/sidebar'
import OnboardingModal from '@/components/dashboard/onboarding-modal'
import { usePathname } from 'next/navigation'
import { useStore } from '@/lib/store-context'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isAssistantPage = pathname === '/ai-assistant'
  const isSettingsPage = pathname === '/settings'
  const { currentStoreId, isStoresLoading, isInitialLoading, accessibleStores } = useStore()

  // Attendre que le store soit chargé ET que l'auto-select soit fait
  // avant d'afficher le contenu, pour éviter le flash "Sélectionnez un store"
  const isStoreReady = !isInitialLoading && !isStoresLoading && (!!currentStoreId || accessibleStores.length === 0)

  if (!isStoreReady) {
    return (
      <div className="flex h-screen bg-background text-foreground">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-3 text-muted-foreground">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="text-sm">Chargement de votre store...</span>
              </div>
            </div>
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar />
      <OnboardingModal />
      <div className="flex-1 flex flex-col min-w-0">
        <main
          className={
            isAssistantPage
              ? 'flex-1 overflow-hidden p-0'
              : isSettingsPage
                ? 'flex-1 overflow-y-auto p-0'
                : 'flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8'
          }
        >
          {children}
        </main>
      </div>
    </div>
  )
}
