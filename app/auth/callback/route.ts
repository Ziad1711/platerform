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
  }

  return NextResponse.redirect(new URL(redirectTo, origin))
}
