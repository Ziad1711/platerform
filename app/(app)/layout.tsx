'use client'

import Sidebar from '@/components/dashboard/sidebar'
import OnboardingModal from '@/components/dashboard/onboarding-modal'
import { usePathname } from 'next/navigation'
import { useStore } from '@/lib/store-context'
import { Loader2 } from 'lucide-react'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isAssistantPage = pathname === '/ai-assistant'
  const isSettingsPage = pathname === '/settings'
  const { isInitialLoading } = useStore()

  // Pendant le chargement initial des stores, on affiche un écran de chargement
  // pour éviter que les composants dashboard n'affichent des données vides
  if (isInitialLoading) {
    return (
      <div className="flex h-screen bg-background text-foreground">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <main className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Chargement de votre espace...</p>
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
