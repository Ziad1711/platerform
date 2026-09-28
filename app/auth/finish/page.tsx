'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { sanitizeRedirectPath } from '@/lib/auth/redirects'

export default function AuthFinishPage() {
  return (
    <Suspense fallback={<FinishLoader />}>
      <AuthFinishInner />
    </Suspense>
  )
}

function AuthFinishInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    // `next` provient d'un lien externe (e-mail d'invitation, URL saisie) : il
    // est validé comme chemin interne pour éviter toute redirection ouverte.
    // `/welcome` n'est jamais honoré « sur demande » : la finalisation du mot
    // de passe est décidée par `resolvePostLoginRedirect`, jamais par l'URL.
    const requested = String(searchParams.get('next') || '')
    const nextIsWelcome = requested === '/welcome' || requested.startsWith('/welcome?')
    const next = nextIsWelcome ? '/dashboard' : sanitizeRedirectPath(requested, '/dashboard')

    async function finish() {
      for (let i = 0; i < 40; i += 1) {
        const { data } = await supabase.auth.getSession()
        if (cancelled) return
        if (data.session) {
          router.replace(next)
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }

      if (!cancelled) router.replace('/login')
    }

    finish()
    return () => {
      cancelled = true
    }
  }, [router, searchParams])

  return <FinishLoader />
}

function FinishLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        Connexion en cours...
      </div>
    </div>
  )
}
