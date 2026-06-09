import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getFirstAllowedRoute, hasPermission, MENU_PERMISSIONS } from '@/lib/auth/permissions'
import { isProtectedAppRoute } from '@/lib/auth/redirects'

export async function middleware(request: NextRequest) {
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
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // Refresh session (getUser vérifie le JWT via API)
  const { data: { user } } = await supabase.auth.getUser()
  const sessionUser = user ?? (await supabase.auth.getSession()).data.session?.user ?? null
  const pathname = request.nextUrl.pathname

  // Permission guards uniquement si l'utilisateur est connecté
  // (le blocage des routes sans session est géré par app/(app)/layout.tsx côté serveur)
  if (sessionUser && isProtectedAppRoute(pathname)) {
    const storeId = request.cookies.get('current-store-id')?.value

    if (storeId) {
      const { data: member, error } = await supabase
        .from('store_members')
        .select('role')
        .eq('store_id', storeId)
        .eq('user_id', sessionUser.id)
        .eq('status', 'active')
        .maybeSingle()

      const defaultRoute = getFirstAllowedRoute(member?.role as any)

      if ((error || !member) && pathname !== defaultRoute) {
        return NextResponse.redirect(new URL(defaultRoute, request.url))
      }

      // Vérifier les permissions spécifiques à la route
      const routePerms = MENU_PERMISSIONS[pathname]
      if (member && routePerms && !routePerms.some((p) => hasPermission(member.role as any, p)) && pathname !== defaultRoute) {
        return NextResponse.redirect(new URL(defaultRoute, request.url))
      }
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
