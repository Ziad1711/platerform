import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getFirstAllowedRoute, hasPermission, MENU_PERMISSIONS } from '@/lib/auth/permissions'
import { isProtectedAppRoute } from '@/lib/auth/redirects'

/** Budget du garde de navigation : au-delà, le rendu serveur reste seul juge. */
const MIDDLEWARE_AUTH_DEADLINE_MS = 4_000

function withDeadline<T>(promise: Promise<T>): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), MIDDLEWARE_AUTH_DEADLINE_MS)),
  ])
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Page d'accueil publique : aucun traitement Auth ni appel Supabase requis
  // pour son affichage. Le renouvellement de session reste assuré lors du
  // prochain accès à une route protégée ou à la page de connexion.
  if (pathname === '/') {
    return NextResponse.next()
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // 1. Propager les cookies renouvelés à la requête : le rendu serveur
          //    doit lire la session à jour, pas un JWT périmé.
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))

          // 2. Reconstruire la réponse à partir de la requête mise à jour, en
          //    conservant les cookies déjà écrits par un appel setAll précédent
          //    (écritures cumulatives, jamais écrasées).
          const previousCookies = response.cookies.getAll()
          response = NextResponse.next({ request })
          previousCookies.forEach((cookie) =>
            response.cookies.set(cookie.name, cookie.value, cookie)
          )

          // 3. Écrire les cookies renouvelés sur la réponse.
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser vérifie le JWT via l'API Auth et renouvelle la session si nécessaire
  // (les cookies éventuels sont écrits via setAll ci-dessus). Une Auth lente ne
  // doit jamais bloquer la navigation jusqu'au délai de la plateforme : au-delà
  // du budget, on laisse le rendu serveur appliquer la garde d'identité.
  const authResult = await withDeadline(supabase.auth.getUser())
  if (!authResult) return response
  const sessionUser = authResult.data.user ?? null

  // Permission guards uniquement si l'utilisateur est connecté
  // (le blocage des routes sans session est géré par app/(app)/layout.tsx côté serveur)
  if (sessionUser && isProtectedAppRoute(pathname)) {
    const storeId = request.cookies.get('current-store-id')?.value

    if (storeId) {
      const membership = await withDeadline(
        Promise.resolve(
          supabase
            .from('store_members')
            .select('role')
            .eq('store_id', storeId)
            .eq('user_id', sessionUser.id)
            .eq('status', 'active')
            .maybeSingle()
        )
      )
      // Lecture non aboutie dans le budget : aucune décision de redirection.
      if (!membership) return response
      const { data: member, error } = membership

      const defaultRoute = getFirstAllowedRoute(member?.role as any)

      if ((error || !member) && pathname !== defaultRoute) {
        return redirectWithSessionCookies(request, response, defaultRoute)
      }

      // Vérifier les permissions spécifiques à la route
      const routePerms = MENU_PERMISSIONS[pathname]
      if (member && routePerms && !routePerms.some((p) => hasPermission(member.role as any, p)) && pathname !== defaultRoute) {
        return redirectWithSessionCookies(request, response, defaultRoute)
      }
    }
  }

  return response
}

/**
 * Construit une redirection en reportant les cookies de session déjà présents
 * sur `response` (y compris un éventuel renouvellement) : sans cela, une
 * session renouvelée pendant `getUser()` serait perdue sur la redirection.
 */
function redirectWithSessionCookies(
  request: NextRequest,
  response: NextResponse,
  path: string
) {
  const redirectResponse = NextResponse.redirect(new URL(path, request.url))
  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie.name, cookie.value, cookie)
  })
  return redirectResponse
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
