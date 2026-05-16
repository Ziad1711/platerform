'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function HashErrorHandler() {
  const router = useRouter()

  useEffect(() => {
    const hash = window.location.hash

    // Gérer les erreurs OTP
    if (hash.includes('error=access_denied') || hash.includes('error_code=otp_expired')) {
      router.replace('/login?error=invitation_expired')
      return
    }

    // Si le hash contient un access_token (invite, magiclink, recovery…)
    // le client Supabase traite automatiquement la session. On redirige vers le dashboard.
    if (
      hash.includes('access_token=') &&
      (hash.includes('type=invite') || hash.includes('type=magiclink') || hash.includes('type=recovery'))
    ) {
      const supabase = createClient()
      // Petit délai pour laisser le SDK parser le hash et stocker la session
      const timeout = setTimeout(async () => {
        const { data } = await supabase.auth.getSession()
        if (data.session) {
          router.replace('/dashboard')
        }
      }, 300)
      return () => clearTimeout(timeout)
    }
  }, [router])

  return null
}
