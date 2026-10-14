/**
 * Consentement à la mesure d'audience (Google Analytics 4).
 *
 * Aucun script de mesure n'est chargé tant que le choix n'a pas été accepté
 * explicitement. Le choix est mémorisé dans le navigateur et diffusé par un
 * évènement local : la barre GTM/GA n'a donc jamais besoin d'un rechargement
 * de page pour démarrer ou pour s'arrêter.
 */

export const ANALYTICS_CONSENT_KEY = 'jisra-analytics-consent'

/** Évènement local émis à chaque changement de choix (même onglet). */
export const ANALYTICS_CONSENT_EVENT = 'jisra:analytics-consent'

/**
 * Ancienne clé du bandeau marketing (« cookies et mesure d'expérience »).
 * Elle ne documentait aucune mesure d'audience : elle ne vaut donc pas
 * consentement GA4 et le visiteur est interrogé à nouveau.
 */
export const LEGACY_COOKIE_CONSENT_KEY = 'jisra-cookie-consent'

export type AnalyticsConsent = 'granted' | 'denied'

/** Choix enregistré, ou `null` tant que le visiteur ne s'est pas prononcé. */
export function readAnalyticsConsent(): AnalyticsConsent | null {
  if (typeof window === 'undefined') return null

  try {
    const stored = window.localStorage.getItem(ANALYTICS_CONSENT_KEY)
    return stored === 'granted' || stored === 'denied' ? stored : null
  } catch {
    return null
  }
}

export function hasAnalyticsConsent(): boolean {
  return readAnalyticsConsent() === 'granted'
}

/**
 * Enregistre le choix. Un refus supprime immédiatement les cookies de mesure
 * déjà déposés, puis prévient les composants abonnés.
 */
export function writeAnalyticsConsent(consent: AnalyticsConsent): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, consent)
  } catch {
    // Stockage indisponible (navigation privée) : le choix reste valable pour
    // la session courante, sans persistance.
  }

  if (consent === 'denied') {
    clearAnalyticsCookies()
  }

  window.dispatchEvent(new Event(ANALYTICS_CONSENT_EVENT))
}

/** Abonne un composant aux changements de choix (même onglet et autres onglets). */
export function subscribeAnalyticsConsent(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  window.addEventListener(ANALYTICS_CONSENT_EVENT, listener)
  window.addEventListener('storage', listener)

  return () => {
    window.removeEventListener(ANALYTICS_CONSENT_EVENT, listener)
    window.removeEventListener('storage', listener)
  }
}

/**
 * Supprime les cookies de mesure (`_ga`, `_ga_<ID>`, `_gid`).
 * Appelé uniquement lors d'un refus ou d'un retrait de consentement.
 */
export function clearAnalyticsCookies(): void {
  if (typeof document === 'undefined') return

  const names = document.cookie
    .split(';')
    .map((entry) => entry.trim().split('=')[0])
    .filter((name) => name === '_ga' || name === '_gid' || name.startsWith('_ga_'))

  if (names.length === 0) return

  const hostname = window.location.hostname
  const labels = hostname.split('.')
  // Domaine parent (`jisra.io` pour `app.jisra.io`), sans sortir du domaine courant.
  const parentDomain = labels.length > 2 ? `.${labels.slice(-2).join('.')}` : ''
  const domains = ['', `.${hostname}`, parentDomain]

  names.forEach((name) => {
    domains.filter(Boolean).concat('').forEach((domain) => {
      document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT${
        domain ? `; domain=${domain}` : ''
      }`
    })
  })
}
