import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import { Providers } from '@/components/providers'
import { SITE_URL } from '@/lib/marketing/site-url'
import HashErrorHandler from '@/components/marketing/hash-error-handler'

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
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="alternate icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body suppressHydrationWarning className="font-sans antialiased">
        <Providers>
          {children}
          <HashErrorHandler />
        </Providers>
      </body>
    </html>
  )
}
