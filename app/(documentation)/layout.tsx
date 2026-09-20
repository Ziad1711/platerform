import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { JisraMark, JisraWordmark } from '@/components/logo'

export const metadata: Metadata = {
  title: {
    default: 'Documentation API | Jisra',
    template: '%s | Jisra',
  },
  description:
    "Documentation publique de l'API Jisra : catalogue produits, prix, stock disponible, envoi des commandes et webhooks pour connecter un site e-commerce.",
}

export default function DocumentationLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <header className="z-40 shrink-0 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <JisraMark size={26} />
            <JisraWordmark size={18} />
          </Link>

          <div className="flex items-center gap-2">
            <Link
              href="/documentation"
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
            >
              Documentation
            </Link>
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Se connecter
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Démarrer
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        {children}

        <footer className="border-t border-border">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p>© {new Date().getFullYear()} Jisra — Documentation API publique.</p>
            <div className="flex flex-wrap items-center gap-4">
              <Link href="/features" className="transition-colors hover:text-foreground">
                Fonctionnalités
              </Link>
              <Link href="/pricing" className="transition-colors hover:text-foreground">
                Tarifs
              </Link>
              <Link href="/contact" className="transition-colors hover:text-foreground">
                Contact
              </Link>
            </div>
          </div>
        </footer>
      </main>
    </div>
  )
}
