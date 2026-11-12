'use client'

import { useEffect, useRef } from 'react'
import { trackEvent } from '@/lib/analytics/gtag'
import type { BillingPeriod } from '@/lib/billing/presentation'
import { usePathname } from 'next/navigation'

/**
 * Événements GA4 du tunnel public. Aucun identifiant, e-mail, référence de
 * demande ni donnée bancaire. `trackEvent` applique déjà consentement,
 * déduplication de page et exclusion des routes non anonymisables : aucune
 * fonction locale ne contourne ce contrôle.
 */
export function PricingTunnelEvents({ period }: { period: BillingPeriod }) {
  const pathname = usePathname()
  const seen = useRef({ view: false, select: false })
  useEffect(() => {
    if (pathname !== '/pricing') return
    if (!seen.current.view) {
      seen.current.view = true
      trackEvent('view_pricing', { billing_period: period })
    }
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href*="/subscribe?"]') as HTMLAnchorElement | null
      if (!link || seen.current.select) return
      const params = new URL(link.href, window.location.origin).searchParams
      const plan = params.get('plan')
      if (plan !== 'pro' && plan !== 'ultimate') return
      seen.current.select = true
      trackEvent('select_plan', { plan, billing_period: params.get('period') || period })
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [pathname, period])
  return null
}
