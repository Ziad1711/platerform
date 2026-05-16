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

    if (hash.includes('access_token=') && hash.includes('type=invite')) {
      const supabase = createClient()
      const timeout = setTimeout(async () => {
        const { data } = await supabase.auth.getUser()
        const token = data.user?.user_metadata?.invitation_token
        if (token) {
          router.replace(`/invite/${token}`)
        }
      }, 100)

      return () => clearTimeout(timeout)
    }
  }, [router])

  return null
}
