import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolvePostLoginRedirect, sanitizeRedirectPath } from '@/lib/auth/redirects'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const nextParam = sanitizeRedirectPath(url.searchParams.get('next'), '/dashboard')
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

  // Récupérer l'utilisateur et déterminer la redirection
  const { data: { user } } = await supabase.auth.getUser()
  let redirectTo = '/dashboard'
  let storeId: string | null = null

  if (user) {
    const { data: member } = await supabase
      .from('store_members')
      .select('role, store_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle()

    const passwordSet = user.user_metadata?.password_set === true
    const hasStore = !!member

    redirectTo = resolvePostLoginRedirect({
      next: nextParam,
      role: member?.role as any ?? null,
      hasStore,
      passwordSet,
    })

    if (member?.store_id) {
      storeId = String(member.store_id)
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
