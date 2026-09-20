import type { Metadata } from 'next'
import { BookOpen } from 'lucide-react'
import { SITE_URL } from '@/lib/marketing/site-url'
import { DocsOverview } from '@/components/documentation/docs-overview'
import { DocsCatalog } from '@/components/documentation/docs-catalog'
import { DocsOrders } from '@/components/documentation/docs-orders'
import { DocsGuides } from '@/components/documentation/docs-guides'
import { DocsMobileNav, DocsSidebar } from '@/components/documentation/docs-sidebar'
import { EndpointRow } from '@/components/documentation/docs-primitives'

export const metadata: Metadata = {
  title: 'Documentation API — Catalogue et commandes',
  description:
    "Connectez votre site e-commerce à Jisra : authentification par clé API, catalogue produits avec prix et stock Jisra, vérification de panier, envoi des commandes et webhooks.",
  alternates: {
    canonical: `${SITE_URL}/documentation`,
  },
  openGraph: {
    title: 'Documentation API Jisra',
    description:
      'Catalogue, prix, stock et commandes : connectez votre site e-commerce à Jisra en quelques appels HTTP.',
    url: `${SITE_URL}/documentation`,
    type: 'article',
    locale: 'fr_MA',
  },
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || SITE_URL

export default function DocumentationPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="grid gap-10 md:grid-cols-[240px_minmax(0,1fr)] md:gap-10 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-12">
        <DocsSidebar />

        <div className="min-w-0">
          <div className="mb-8 md:hidden">
            <DocsMobileNav />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-[#1fa971]/20 bg-[#1fa971]/10 px-2.5 py-1 font-semibold text-[#1fa971]">
              API v1
            </span>
            <span className="rounded-full border border-border bg-muted px-2.5 py-1 font-medium text-muted-foreground">
              Stable
            </span>
            <span className="text-muted-foreground">Dernière mise à jour : septembre 2026</span>
          </div>

          <h1 className="mt-4 flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            <BookOpen className="h-6 w-6 text-primary" />
            Documentation API — Site web personnalisé
          </h1>

          <div className="mt-10 space-y-10">
            <DocsOverview baseUrl={API_BASE_URL} />
            <DocsCatalog baseUrl={API_BASE_URL} />
            <DocsOrders baseUrl={API_BASE_URL} />
            <DocsGuides baseUrl={API_BASE_URL} />
          </div>
        </div>
      </div>
    </div>
  )
}

