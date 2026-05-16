'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

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
    const next = searchParams.get('next') || '/dashboard'

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
