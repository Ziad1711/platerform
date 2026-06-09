'use client'

import { useEffect, useState } from 'react'
import Sidebar from '@/components/dashboard/sidebar'
import OnboardingModal from '@/components/dashboard/onboarding-modal'
import { usePathname } from 'next/navigation'
import { ChevronUp } from 'lucide-react'
import { Toaster } from 'sonner'

function BackToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const main = document.querySelector('main')
    if (!main) return
    const onScroll = () => setVisible(main.scrollTop > 400)
    main.addEventListener('scroll', onScroll, { passive: true })
    return () => main.removeEventListener('scroll', onScroll)
  }, [])

  const scrollToTop = () => {
    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <button
      onClick={scrollToTop}
      className={`fixed bottom-8 right-6 z-50 w-11 h-11 rounded-full bg-background border border-border shadow-lg shadow-[#1fa971]/30 text-[#1fa971] hover:bg-gradient-to-br hover:from-[#1fa971] hover:to-[#178a5a] hover:text-white hover:shadow-xl hover:shadow-[#1fa971]/50 hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
      }`}
      aria-label="Retour en haut"
    >
      <ChevronUp className="w-4 h-4" />
    </button>
  )
}

export default function AppLayoutClient({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const isAssistantPage = pathname === '/ai-assistant'
  const isSettingsPage = pathname === '/settings'

  if (!mounted) {
    return (
      <div className="flex h-screen bg-background text-foreground">
        <div className="flex-1 flex flex-col min-w-0">
          <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8" />
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
      <Toaster position="bottom-right" richColors closeButton />
      <BackToTop />
    </div>
  )
}
