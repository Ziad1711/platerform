/**
 * Client GA4 minimal (gtag.js) — utilisable uniquement côté navigateur.
 *
 * Principes :
 * - le script n'est chargé que si `NEXT_PUBLIC_GA_MEASUREMENT_ID` est défini
 *   ET si le consentement a été accordé ;
 * - `send_page_view: false` (voir `components/analytics/google-analytics.tsx`)
 *   évite le page_view automatique : les pages sont signalées explicitement,
 *   une seule fois par changement de route ;
 * - aucune URL brute n'est transmise : le chemin est nettoyé (paramètres de
 *   requête retirés, identifiants remplacés) et le titre est omis dans
 *   l'espace applicatif privé ;
 * - les pages dont l'URL ne peut pas être anonymisée de façon fiable ne sont
 *   jamais mesurées (`lib/analytics/sanitize.ts`) ;
 * - le contexte global est réécrit à chaque changement de route
 *   (`applyGlobalPageContext`) afin que les évènements collectés
 *   automatiquement par la librairie (défilement, clics sortants, changements
 *   d'historique) n'envoient pas non plus l'URL brute du navigateur.
 */

import { hasAnalyticsConsent } from './consent'
import { isUntrackableRoute, sanitizeReferrer, sanitizeTrackingPath } from './sanitize'
import { isProtectedAppRoute } from '@/lib/auth/redirects'

/** Identifiant de mesure GA4 ; vide = mesure désactivée. */
export const GA_MEASUREMENT_ID = (process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || '').trim()

/** Mode débogage GA4, à activer ponctuellement pour DebugView. */
export const GA_DEBUG_MODE =
  (process.env.NEXT_PUBLIC_GA_DEBUG || '').trim() === '1' ||
  (process.env.NEXT_PUBLIC_GA_DEBUG || '').trim().toLowerCase() === 'true'

/** Format accepté pour un identifiant de mesure (validation avant injection). */
const MEASUREMENT_ID_PATTERN = /^(G|GT|GTM|AW)-[A-Z0-9]{4,}$/i

export function isValidMeasurementId(id: string): boolean {
  return MEASUREMENT_ID_PATTERN.test(id)
}

type GtagParams = Record<string, unknown>

type GtagFunction = (...args: unknown[]) => void

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: GtagFunction
  }
}

/** Récupère (ou amorce) la file `dataLayer`/`gtag` : les évènements envoyés
 * avant le chargement de gtag.js sont conservés puis rejoués par la librairie. */
function getGtag(): GtagFunction | null {
  if (typeof window === 'undefined') return null

  if (typeof window.gtag !== 'function') {
    window.dataLayer = window.dataLayer || []
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments)
    }
  }

  return window.gtag
}

/** Mesure active ? (identifiant valide + consentement accordé) */
export function isAnalyticsEnabled(): boolean {
  return isValidMeasurementId(GA_MEASUREMENT_ID) && hasAnalyticsConsent()
}

export function setAnalyticsCollectionDisabled(disabled: boolean): void {
  if (typeof window === 'undefined' || !isValidMeasurementId(GA_MEASUREMENT_ID)) return
  // Drapeau d'opposition officiel GA4 : coupe toute collecte restante si la
  // librairie a déjà été chargée puis que le consentement est retiré.
  const flags = window as unknown as Record<string, unknown>
  flags[`ga-disable-${GA_MEASUREMENT_ID}`] = disabled
}

/**
 * Nettoyage des URL et filtrage des pages non anonymisables : implémentation
 * partagée avec Vercel Web Analytics dans `lib/analytics/sanitize.ts`.
 */

/** Contexte de page transmis avec chaque hit : version nettoyée, sans donnée métier. */
function buildPageContext(pathname: string): GtagParams {
  const path = sanitizeTrackingPath(pathname)
  const context: GtagParams = {
    page_path: path,
    page_location: `${window.location.origin}${path}`,
  }

  const referrer = sanitizeReferrer()
  if (referrer) context.page_referrer = referrer

  // Le titre est omis dans l'espace privé : il peut contenir le nom d'une boutique.
  if (!isProtectedAppRoute(pathname) && typeof document !== 'undefined' && document.title) {
    context.page_title = document.title
  }

  return context
}

/**
 * Aligne le contexte global (`gtag('set')`) sur la page courante.
 *
 * Portée « global » : les paramètres s'appliquent à tous les évènements envoyés
 * à la mesure, y compris ceux collectés automatiquement par la librairie, qui
 * utiliseraient sinon l'URL brute du navigateur. Un paramètre de portée
 * « event » restant prioritaire, nos propres hits ne sont pas affectés.
 */
function applyGlobalPageContext(pathname: string): void {
  const gtag = getGtag()
  if (!gtag || typeof document === 'undefined') return

  const path = sanitizeTrackingPath(pathname)
  const referrer = sanitizeReferrer()

  gtag('set', {
    page_path: path,
    page_location: `${window.location.origin}${path}`,
    // Titre neutre dans l'espace privé : il peut contenir le nom d'une boutique.
    page_title: isProtectedAppRoute(pathname) ? 'Jisra' : document.title || '',
    // Référent nettoyé : les hits automatiques enverraient sinon l'URL brute
    // de la page précédente (avec ses paramètres).
    ...(referrer ? { page_referrer: referrer } : {}),
  })
}

/** Envoie un évènement GA4. Sans effet si le consentement n'est pas accordé. */
export function trackEvent(
  name: string,
  params: GtagParams = {},
  options: { beacon?: boolean } = {},
): void {
  if (!isAnalyticsEnabled()) return

  // Page non anonymisable : aucun évènement, même avec un contexte nettoyé.
  if (typeof window !== 'undefined' && isUntrackableRoute(window.location.pathname)) return

  const gtag = getGtag()
  if (!gtag) return

  gtag('event', name, {
    ...buildPageContext(window.location.pathname),
    ...params,
    // `beacon` : évite de perdre l'évènement quand une navigation suit
    // immédiatement (inscription, connexion).
    ...(options.beacon ? { transport_type: 'beacon' } : {}),
    ...(GA_DEBUG_MODE ? { debug_mode: true } : {}),
  })
}

// État du client. `initialized` garantit un seul `gtag('config')` par session
// de consentement ; `lastTrackedPagePath` évite les page_view en double.
let initialized = false
let lastTrackedPagePath: string | null = null

/**
 * Initialise la destination GA4. À appeler avant tout `page_view` : la commande
 * `config` est ainsi toujours traitée en premier par gtag.js, y compris quand
 * la librairie n'est pas encore téléchargée (les commandes sont mises en file).
 */
export function initializeAnalytics(): void {
  if (initialized || !isAnalyticsEnabled()) return

  const gtag = getGtag()
  if (!gtag) return

  initialized = true
  gtag('js', new Date())
  gtag('config', GA_MEASUREMENT_ID, {
    // Les pages sont déclarées explicitement via `trackPageView`.
    send_page_view: false,
    ...(GA_DEBUG_MODE ? { debug_mode: true } : {}),
  })
}

/**
 * Signale un page_view nettoyé. Ignoré si le même chemin a déjà été envoyé.
 * @returns `true` si l'évènement a été transmis.
 */
export function trackPageView(pathname: string): boolean {
  if (!isAnalyticsEnabled()) return false

  // Page non anonymisable : aucune page vue, même nettoyée.
  if (isUntrackableRoute(pathname)) return false

  const gtag = getGtag()
  if (!gtag) return false

  // Contexte global d'abord : il couvre aussi les évènements collectés
  // automatiquement par la librairie sur cette page.
  applyGlobalPageContext(pathname)

  const path = sanitizeTrackingPath(pathname)
  if (path === lastTrackedPagePath) return false

  lastTrackedPagePath = path
  gtag('event', 'page_view', {
    ...buildPageContext(pathname),
    ...(GA_DEBUG_MODE ? { debug_mode: true } : {}),
  })

  return true
}

/** Réinitialise l'état local après un refus ou un retrait de consentement. */
export function resetAnalyticsState(): void {
  initialized = false
  lastTrackedPagePath = null
}
