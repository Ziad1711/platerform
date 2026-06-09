import { getFirstAllowedRoute, type Role } from './permissions'

// ─── Route classification ────────────────────────────────────────

const PROTECTED_APP_ROUTES = [
  '/dashboard',
  '/sales',
  '/products',
  '/stock',
  '/suppliers',
  '/advertising',
  '/expenses',
  '/integrations',
  '/delivery',
  '/ai-assistant',
  '/settings',
  '/subscription',
]

const AUTH_ROUTES = ['/login', '/signup']

const SPECIAL_AUTH_ROUTES = [
  '/auth/callback',
  '/auth/finish',
  '/welcome',
  '/invite',
]

/**
 * Vérifie si un pathname correspond à une route protégée de l'app.
 */
export function isProtectedAppRoute(pathname: string): boolean {
  return PROTECTED_APP_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + '/'),
  )
}

/**
 * Vérifie si un pathname correspond à une page d'auth (login / signup).
 */
export function isAuthPage(pathname: string): boolean {
  return AUTH_ROUTES.includes(pathname)
}

/**
 * Vérifie si un pathname correspond à une route spéciale d'auth
 * (callback, welcome, invite, etc.).
 */
export function isSpecialAuthRoute(pathname: string): boolean {
  return SPECIAL_AUTH_ROUTES.some((route) => pathname.startsWith(route))
}

// ─── Redirect helpers ────────────────────────────────────────────

/**
 * Construit une URL de redirection vers la page de login
 * en conservant le paramètre `next` pour revenir après connexion.
 */
export function buildLoginRedirect(
  pathname: string,
  searchParams?: string,
): string {
  const currentPath = searchParams
    ? `${pathname}?${searchParams}`
    : pathname
  return `/login?next=${encodeURIComponent(currentPath)}`
}

/**
 * Résout la destination après connexion en fonction de :
 * - `next` : paramètre explicite de redirection
 * - `role` : rôle de l'utilisateur (pour la route par défaut)
 * - `hasStore` : si l'utilisateur a au moins un store
 * - `passwordSet` : si l'utilisateur a déjà défini son mot de passe
 */
export function resolvePostLoginRedirect(options: {
  next?: string | null
  role: Role | null
  hasStore: boolean
  passwordSet: boolean
}): string {
  const { next, role, hasStore, passwordSet } = options

  // Si l'utilisateur n'a pas encore défini son mot de passe
  if (!passwordSet) return '/welcome'

  // Si l'utilisateur n'a pas de store → page d'accueil ou création
  if (!hasStore) return '/welcome'

  // Si un `next` explicite est fourni et valide
  if (next && next.startsWith('/') && !next.startsWith('//')) {
    return next
  }

  // Route par défaut selon le rôle
  return getFirstAllowedRoute(role)
}

/**
 * Nettoie un chemin de redirection interne pour éviter les attaques
 * par redirection ouverte (open redirect).
 */
export function sanitizeRedirectPath(
  rawPath: string | null | undefined,
  fallback = '/dashboard',
): string {
  const value = String(rawPath || '').trim()
  if (!value) return fallback
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//')) return fallback
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) return fallback
  if (value.includes('\\')) return fallback
  return value
}
