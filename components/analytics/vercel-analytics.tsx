'use client'

import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next'
import { sanitizeTrackingUrl } from '@/lib/analytics/sanitize'

/**
 * Vercel Web Analytics — mesure agrégée du trafic, sans cookie et sans
 * stockage sur l'appareil, active indépendamment du consentement GA4.
 *
 * `beforeSend` décide de ce qui part réellement au serveur :
 * - URL nettoyée (paramètres de requête, ancre et identifiants retirés) ;
 * - `null` sur les routes non anonymisables (`/auth/*`, `/invite/*`,
 *   `/delivery/vouchers/*`) : aucun évènement n'est transmis.
 */
export function VercelAnalytics() {
  return (
    <Analytics
      beforeSend={(event: BeforeSendEvent): BeforeSendEvent | null => {
        const url = sanitizeTrackingUrl(event.url)
        if (!url) return null
        return { ...event, url }
      }}
    />
  )
}
