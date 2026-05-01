'use client'

import Sidebar from '@/components/dashboard/sidebar'
import OnboardingModal from '@/components/dashboard/onboarding-modal'
import { usePathname } from 'next/navigation'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isAssistantPage = pathname === '/ai-assistant'
  const isSettingsPage = pathname === '/settings'

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
