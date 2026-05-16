import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { hasPermission, MENU_PERMISSIONS } from '@/lib/auth/permissions'

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

  // Utiliser getUser() (vérification JWT via API) avec fallback getSession()
  // pour être fiable sur Edge Runtime (Vercel) où les cookies SSR peuvent être
  // inaccessibles localement
  const { data: { user } } = await supabase.auth.getUser()
  const sessionUser = user ?? (await supabase.auth.getSession()).data.session?.user ?? null
  const pathname = request.nextUrl.pathname

  // Routes protégées
  const protectedPaths = ['/dashboard', '/sales', '/products', '/stock', '/suppliers', '/advertising', '/expenses', '/integrations', '/delivery', '/ai-assistant', '/staff', '/subscription', '/settings']
  const isProtected = protectedPaths.some(p => pathname === p || pathname.startsWith(p + '/'))

  // NE PAS rediriger si l'utilisateur n'est pas trouvé - laisser les pages server
  // gérer l'auth avec getServerUser() qui a un fallback getSession() fiable.
  // Ceci évite la boucle de redirections quand le middleware (Edge Runtime)
  // ne trouve pas la session mais que la page server la trouve.

  // Permission guards seulement si l'utilisateur est trouvé
  if (sessionUser && isProtected) {
    const storeId = request.cookies.get('current-store-id')?.value

    if (storeId) {
      const { data: member, error } = await supabase
        .from('store_members')
        .select('role')
        .eq('store_id', storeId)
        .eq('user_id', sessionUser.id)
        .eq('status', 'active')
        .maybeSingle()

      if ((error || !member) && pathname !== '/dashboard') {
        return NextResponse.redirect(new URL('/dashboard', request.url))
      }

      // Vérifier les permissions spécifiques à la route
      const routePerms = MENU_PERMISSIONS[pathname]
      if (member && routePerms && !routePerms.some((p) => hasPermission(member.role as any, p))) {
        return NextResponse.redirect(new URL('/dashboard', request.url))
      }
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
