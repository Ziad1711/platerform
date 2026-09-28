import { getFirstAllowedRoute, type Role } from './permissions'

// ─── Route classification ────────────────────────────────────────

const PROTECTED_APP_ROUTES = [
  '/dashboard',
  '/sales',
  '/confirmation',
  '/products',
  '/stock',
  '/suppliers',
  '/advertising',
  '/expenses',
  '/integrations',
  '/delivery',
  '/finances',
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
 * Résout la destination après connexion selon trois états distincts :
 * - `needsPassword` : compte invité qui n'a PAS encore défini son mot de passe
 *   (`user_metadata.password_set === false`). C'est la seule raison d'envoyer
 *   un utilisateur vers `/welcome`. L'absence du marqueur (`undefined`) signifie
 *   que le mot de passe a été choisi à l'inscription : ce n'est pas un compte
 *   à finaliser.
 * - `hasStore` / `role` : accès à au moins un store **actif** (propriété ou
 *   appartenance `status = 'active'`).
 * - `next` : paramètre explicite de redirection fourni par l'appelant.
 * - `accessLookupFailed` : la lecture de l'accès a échoué. Ni le rôle ni la
 *   présence d'un store ne sont connus : on ne conclut rien de cette lecture
 *   ratée (destination neutre, jamais `/welcome`).
 */
export function resolvePostLoginRedirect(options: {
  next?: string | null
  role: Role | null
  hasStore: boolean
  needsPassword: boolean
  accessLookupFailed?: boolean
}): string {
  const { next, role, hasStore, needsPassword, accessLookupFailed = false } = options

  // Redirection explicite demandée par l'appelant, limitée aux chemins internes.
  const requestedNext =
    next && next.startsWith('/') && !next.startsWith('//') ? next : null
  // `/welcome` n'est jamais honoré « sur demande » : c'est la règle de finalisation
  // ci-dessous qui décide, sinon un compte déjà finalisé pourrait y être renvoyé.
  const nextIsWelcome =
    requestedNext === '/welcome' || (requestedNext?.startsWith('/welcome?') ?? false)

  // 1. Lecture de l'accès en échec : une lecture ratée ne prouve ni l'absence de
  //    store ni l'absence de mot de passe. Aucune conclusion n'en est tirée et
  //    `/welcome` est le seul interdit (il ferait « finaliser » un compte abouti).
  if (accessLookupFailed) {
    return nextIsWelcome ? '/dashboard' : requestedNext ?? '/dashboard'
  }

  // 2. Compte invité sans mot de passe **et sans store** → page de finalisation.
  //    Règle identique à celle appliquée par `/welcome` : un invité qui a déjà
  //    un store actif entre directement dans l'app.
  //    Une destination explicitement demandée (ex. `/invite/<token>`) est
  //    transmise à `/welcome` pour être rejouée après la finalisation : sans
  //    cela, la finalisation du mot de passe ferait perdre l'invitation.
  if (needsPassword && !hasStore) {
    return requestedNext && !nextIsWelcome
      ? `/welcome?next=${encodeURIComponent(requestedNext)}`
      : '/welcome'
  }

  // 3. Redirection explicite demandée par l'appelant
  if (requestedNext && !nextIsWelcome) return requestedNext

  // 4. Compte authentifié sans store actif : il entre dans l'espace applicatif,
  //    où le modal d'onboarding propose la création du store. Aucun utilisateur
  //    déjà authentifié n'est renvoyé vers `/welcome`.
  if (!hasStore) return '/dashboard'

  // 5. Route par défaut selon le rôle
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
