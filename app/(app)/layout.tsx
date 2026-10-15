import { redirect } from 'next/navigation'
import { getServerUserResult } from '@/lib/supabase/server'
import { AppProviders } from '@/components/providers'
import AppLayoutClient from './layout-client'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, authUnavailable } = await getServerUserResult()

  // Indisponibilité temporaire de l'API Auth : ne pas rediriger vers /login
  // (l'utilisateur est probablement connecté) ; afficher un état de réessai.
  if (authUnavailable) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="mx-auto w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-lg">
          <h1 className="text-lg font-semibold">
            Service d&apos;authentification indisponible
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Impossible de vérifier votre session pour le moment. Veuillez réessayer
            dans quelques instants.
          </p>
          <a
            href="/login"
            className="mt-5 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Réessayer
          </a>
        </div>
      </div>
    )
  }

  if (!user) {
    redirect('/login')
  }

  return (
    <AppProviders>
      <AppLayoutClient>{children}</AppLayoutClient>
    </AppProviders>
  )
}
