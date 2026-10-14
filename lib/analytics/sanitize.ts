/**
 * Nettoyage des URL avant mesure d'audience — implémentation partagée par
 * GA4 (`lib/analytics/gtag.ts`) et Vercel Web Analytics
 * (`components/analytics/vercel-analytics.tsx`).
 *
 * Règles :
 * - les paramètres de requête et l'ancre sont retirés (ils peuvent contenir
 *   une donnée métier ou personnelle) ;
 * - les segments opaques (identifiants numériques, UUID, jetons, clés de
 *   colis, données encodées) sont remplacés par `[id]` ;
 * - les routes dont le chemin porte un secret ne sont jamais mesurées
 *   (`UNTRACKABLE_ROUTE_PREFIXES`) : les appelants doivent alors ne rien
 *   transmettre du tout.
 */

/** Segments de chemin jamais exploitables comme libellé de page. */
export const OPAQUE_SEGMENT_PATTERNS: RegExp[] = [
  /^\d+$/, // identifiant numérique
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // UUID
  /^[0-9a-f]{8,}$/i, // chaîne hexadécimale (jeton d'invitation, empreinte)
  /^(?=.*\d)(?=.*[a-z])[a-z0-9]{6,}$/i, // lettres + chiffres : jeton court, clé de colis
  /[A-Za-z0-9_-]{16,}/, // segment long : jamais un mot de route
  /[@=+%]/, // donnée encodée (e-mail, clé=valeur)
]

/**
 * Routes jamais mesurées, ni par GA4 ni par Vercel Analytics : leur chemin
 * contient un secret ou une donnée rattachable à une personne (jeton
 * d'invitation, lien d'authentification, bon de livraison consultable par clé).
 */
export const UNTRACKABLE_ROUTE_PREFIXES: string[] = [
  '/auth',
  '/invite',
  '/delivery/vouchers',
]

/** Chemin nu : sans requête, sans ancre, avec une barre oblique initiale. */
function normalizePathname(pathname: string): string {
  const raw = String(pathname || '/').split(/[?#]/)[0]
  return raw.startsWith('/') ? raw : `/${raw}`
}

/** Route dont le chemin ne doit jamais être transmis à un outil de mesure ? */
export function isUntrackableRoute(pathname: string): boolean {
  const path = normalizePathname(pathname).toLowerCase()

  return UNTRACKABLE_ROUTE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  )
}

/**
 * Nettoie un chemin avant transmission :
 * paramètres de requête et ancre retirés, identifiants/jetons masqués.
 * Ex. `/invite/3f9c1e7a-…` → `/invite/[id]`, `/sales?tab=…` → `/sales`.
 */
export function sanitizeTrackingPath(pathname: string): string {
  const cleaned = normalizePathname(pathname)
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (OPAQUE_SEGMENT_PATTERNS.some((pattern) => pattern.test(segment))) return '[id]'
      return segment.toLowerCase()
    })
    .join('/')

  return cleaned ? `/${cleaned}`.slice(0, 120) : '/'
}

/** Origine de repli pour résoudre une URL relative (aucune requête réseau). */
function getBaseOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin
  return 'http://localhost'
}

/**
 * Version mesurable d'une URL : origine conservée, chemin nettoyé, requête et
 * ancre retirées.
 *
 * @returns la chaîne à transmettre, ou `''` quand rien ne doit être envoyé
 * (URL illisible ou route non anonymisable).
 */
export function sanitizeTrackingUrl(url: string): string {
  if (!url) return ''

  let parsed: URL
  try {
    parsed = new URL(url, getBaseOrigin())
  } catch {
    return ''
  }

  if (isUntrackableRoute(parsed.pathname)) return ''

  return `${parsed.origin}${sanitizeTrackingPath(parsed.pathname)}`
}

/**
 * Référent nettoyé : origine seule si la navigation vient du site lui-même
 * (le chemin précédent peut contenir un identifiant de commande ou de colis).
 */
export function sanitizeReferrer(): string {
  if (typeof document === 'undefined' || !document.referrer) return ''

  let parsed: URL
  try {
    parsed = new URL(document.referrer)
  } catch {
    return ''
  }

  if (typeof window !== 'undefined' && parsed.origin === window.location.origin) {
    return window.location.origin
  }

  return `${parsed.origin}${parsed.pathname}`
}
