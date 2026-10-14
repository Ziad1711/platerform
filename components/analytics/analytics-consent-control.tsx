'use client'

import { useEffect, useState } from 'react'
import {
  readAnalyticsConsent,
  subscribeAnalyticsConsent,
  writeAnalyticsConsent,
  type AnalyticsConsent,
} from '@/lib/analytics/consent'

/**
 * Contrôle de consentement : permet d'accepter, de refuser ou de retirer le
 * consentement à tout moment (politique de confidentialité, paramètres de l'app).
 */
type AnalyticsConsentControlProps = {
  /** `marketing` = fond sombre Jisra ; `app` = thème du tableau de bord. */
  variant?: 'marketing' | 'app'
}

const VARIANT_STYLES = {
  marketing: {
    container: 'rounded-[24px] border border-white/10 bg-white/[0.03] p-5',
    status: 'text-sm font-semibold text-jisra-cream',
    accept:
      'inline-flex min-h-11 items-center justify-center rounded-2xl bg-jisra-green px-4 py-2 text-sm font-semibold text-white transition hover:bg-jisra-green-light disabled:cursor-not-allowed disabled:opacity-45',
    decline:
      'inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-jisra-cream/82 transition hover:border-white/24 hover:text-jisra-cream disabled:cursor-not-allowed disabled:opacity-45',
  },
  app: {
    container: 'rounded-2xl border bg-background p-4',
    status: 'text-sm font-semibold text-foreground',
    accept:
      'inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45',
    decline:
      'inline-flex min-h-11 items-center justify-center rounded-xl border bg-background px-4 py-2 text-sm font-medium transition hover:bg-secondary/50 disabled:cursor-not-allowed disabled:opacity-45',
  },
} as const

export function AnalyticsConsentControl({
  variant = 'marketing',
}: AnalyticsConsentControlProps = {}) {
  const styles = VARIANT_STYLES[variant]
  const [consent, setConsent] = useState<AnalyticsConsent | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const sync = () => setConsent(readAnalyticsConsent())
    sync()
    setReady(true)
    return subscribeAnalyticsConsent(sync)
  }, [])

  const status = !ready
    ? 'Vérification de votre choix…'
    : consent === 'granted'
      ? 'Mesure d’audience activée. Vous pouvez la désactiver à tout moment.'
      : consent === 'denied'
        ? 'Mesure d’audience refusée. Aucune donnée d’audience n’est collectée.'
        : 'Aucun choix enregistré : la mesure d’audience reste désactivée.'

  return (
    <div className={styles.container}>
      <p className={styles.status}>{status}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => writeAnalyticsConsent('granted')}
          disabled={consent === 'granted'}
          className={styles.accept}
        >
          Accepter la mesure d’audience
        </button>
        <button
          type="button"
          onClick={() => writeAnalyticsConsent('denied')}
          disabled={consent === 'denied'}
          className={styles.decline}
        >
          {consent === 'granted' ? 'Retirer mon consentement' : 'Refuser'}
        </button>
      </div>
    </div>
  )
}
