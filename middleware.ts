import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

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
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const pathname = request.nextUrl.pathname

  // Routes protégées (toutes les pages de l'app)
  const protectedPaths = ['/dashboard', '/sales', '/products', '/stock', '/suppliers', '/advertising', '/expenses', '/integrations', '/delivery', '/ai-assistant', '/staff', '/subscription', '/settings']
  const isProtected = protectedPaths.some(p => pathname === p || pathname.startsWith(p + '/'))

  if (!user && isProtected) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Si l'utilisateur est connecté et essaie d'accéder à la page de login
  if (user && (pathname === '/login' || pathname === '/signup')) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}