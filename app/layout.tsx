import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import { Providers } from '@/components/providers'

export const metadata: Metadata = {
  metadataBase: new URL('https://jisra.app'),
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
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body suppressHydrationWarning className="font-sans antialiased">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
