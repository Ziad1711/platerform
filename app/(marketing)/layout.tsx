import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { MarketingHeader } from '@/components/marketing/layout/header'
import { MarketingFooter } from '@/components/marketing/layout/footer'
import { PageTransition } from '@/components/marketing/shared/page-transition'
import { ScrollToTopButton } from '@/components/marketing/shared/scroll-to-top'
import { CookieBanner } from '@/components/marketing/shared/cookie-banner'

export const metadata: Metadata = {
  title: {
    default: 'jisra — ERP e-commerce pour le Maroc',
    template: '%s | jisra',
  },
  description:
    'ERP SaaS tout-en-un pour e-commerçants marocains. Commandes, stock, livraison, Facebook Ads et vraie rentabilité dans une seule interface.',
  openGraph: {
    title: 'jisra — ERP e-commerce pour le Maroc',
    description:
      'Centralisez ventes, publicité, livraison et profit net dans un ERP conçu pour le marché marocain.',
    type: 'website',
    locale: 'fr_MA',
  },
}

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-jisra-ink text-jisra-cream">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(31,169,113,0.16),transparent_24%),linear-gradient(180deg,#111714_0%,#121916_34%,#111714_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:radial-gradient(circle_at_1px_1px,rgba(243,239,230,0.9)_1px,transparent_0)] [background-size:28px_28px]" />
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-white focus:px-4 focus:py-2">
        Aller au contenu
      </a>
      <MarketingHeader />
      <main id="main-content" className="relative z-10">
        <PageTransition>{children}</PageTransition>
      </main>
      <MarketingFooter />
      <CookieBanner />
      <ScrollToTopButton />
    </div>
  )
}