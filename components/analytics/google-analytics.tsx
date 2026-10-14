'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Script from 'next/script'
import { hasAnalyticsConsent, subscribeAnalyticsConsent } from '@/lib/analytics/consent'
import {
  GA_MEASUREMENT_ID,
  initializeAnalytics,
  isValidMeasurementId,
  resetAnalyticsState,
  setAnalyticsCollectionDisabled,
  trackPageView,
} from '@/lib/analytics/gtag'

/**
 * Intégration GA4 (unique point de chargement de `gtag.js`).
 *
 * - chargement seulement après consentement explicite : aucun script, aucun
 *   cookie de mesure avant le choix du visiteur ;
 * - les changements de route sont signalés par `trackPageView` (dédupliqué),
 *   avec un chemin nettoyé : pas de paramètres de requête ni d'identifiants ;
 * - un refus ou un retrait coupe la collecte et supprime les cookies `_ga`.
 */
export function GoogleAnalytics() {
  const pathname = usePathname()
  const [granted, setGranted] = useState(false)

  useEffect(() => {
    const sync = () => setGranted(hasAnalyticsConsent())
    sync()
    return subscribeAnalyticsConsent(sync)
  }, [])

  useEffect(() => {
    if (!granted) {
      // Retrait ou refus : drapeau d'opposition GA4 + remise à zéro de l'état.
      setAnalyticsCollectionDisabled(true)
      resetAnalyticsState()
      return
    }

    setAnalyticsCollectionDisabled(false)
    initializeAnalytics()
    trackPageView(pathname)
  }, [granted, pathname])

  if (!granted || !isValidMeasurementId(GA_MEASUREMENT_ID)) return null

  return (
    <Script
      id="jisra-ga"
      src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
      strategy="afterInteractive"
    />
  )
}
