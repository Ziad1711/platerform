'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function HashErrorHandler() {
  const router = useRouter()

  useEffect(() => {
    const hash = window.location.hash
    if (hash.includes('error=access_denied') || hash.includes('error_code=otp_expired')) {
      router.replace('/login?error=invitation_expired')
    }
  }, [router])

  return null
}
