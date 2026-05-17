import { NextResponse } from 'next/server'
import { sanitizeInternalRedirectPath } from '@/lib/assistant/security'
import { createClient } from '@/lib/supabase/server'
import { getFirstAllowedRoute } from '@/lib/auth/permissions'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const nextParam = sanitizeInternalRedirectPath(url.searchParams.get('next'), '/dashboard')
  const origin = url.origin

  if (!code) {
    return NextResponse.redirect(new URL('/login', origin))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(new URL('/login?error=callback', origin))
  }

  await fetch(new URL('/api/auth/finalize-profile', origin), {
    method: 'POST',
    headers: {
      cookie: request.headers.get('cookie') || '',
    },
    cache: 'no-store',
  }).catch(() => null)

  // Rediriger vers la bonne page selon le rôle
  const { data: { user } } = await supabase.auth.getUser()
  let redirectTo = nextParam
  let storeId: string | null = null
  if (user) {
    const { data: member } = await supabase
      .from('store_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle()
    const role = (member?.role as import('@/lib/auth/permissions').Role | null | undefined) ?? null
    const defaultRoute = getFirstAllowedRoute(role)
    if (nextParam === '/dashboard') {
      redirectTo = defaultRoute
    }

    // Récupérer le premier store accessible pour set le cookie
    // Évite le flash "sélectionnez un store" pour les nouveaux utilisateurs
    const { data: membership } = await supabase
      .from('store_members')
      .select('store_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle()
    if (membership?.store_id) {
      storeId = String(membership.store_id)
    }
  }

  const response = NextResponse.redirect(new URL(redirectTo, origin))
  if (storeId) {
    response.cookies.set('current-store-id', storeId, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    })
  }
  return response
}
