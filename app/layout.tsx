import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import { Providers } from '@/components/providers'
import { THEME_INIT_SCRIPT } from '@/lib/theme-init'
import { SITE_URL } from '@/lib/marketing/site-url'
import HashErrorHandler from '@/components/marketing/hash-error-handler'
import { GoogleAnalytics } from '@/components/analytics/google-analytics'
import { VercelAnalytics } from '@/components/analytics/vercel-analytics'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Jisra - SaaS e-commerce/ERP',
  description: 'Plateforme SaaS pour e-commerçants - Gestion business complète',
  applicationName: 'Jisra',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Jisra',
  },
  manifest: '/manifest.json',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#1f2a23',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        {/* Thème appliqué avant le premier paint : aucun flash sombre/clair. */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="alternate icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body suppressHydrationWarning className="font-sans antialiased">
        <Providers>
          {children}
          <HashErrorHandler />
          {/* Mesure agrégée sans cookie (aucun consentement requis) */}
          <VercelAnalytics />
          {/* Mesure détaillée GA4, chargée uniquement après consentement */}
          <GoogleAnalytics />
        </Providers>
      </body>
    </html>
  )
}
