'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/** Cache privé neuf, jamais celui de l'espace public ou d'une boutique. */
export function AdminSessionBoundary({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } } }))
  useEffect(() => {
    let identity: string | undefined
    const { data } = createClient().auth.onAuthStateChange((event, session) => {
      const changed = identity !== undefined && session?.user.id !== identity
      if (session?.user.id) identity = session.user.id
      if (event === 'SIGNED_OUT' || changed) {
        client.clear()
        window.location.replace(event === 'SIGNED_OUT' ? '/login?next=%2Fadmin' : '/admin')
      }
    })
    return () => { data.subscription.unsubscribe(); client.clear() }
  }, [client])
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}