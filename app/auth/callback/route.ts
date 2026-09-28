import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolvePostLoginRedirect, sanitizeRedirectPath } from '@/lib/auth/redirects'
import { getUserAccess } from '@/lib/auth/access'

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

  if (user) {
    const access = await getUserAccess(supabase, user.id)
    // Seul un marqueur explicite `password_set === false` (compte invité)
    // déclenche la page de finalisation du mot de passe.
    const needsPassword = user.user_metadata?.password_set === false

    redirectTo = resolvePostLoginRedirect({
      next: nextParam,
      role: access.role,
      hasStore: access.hasStore,
      needsPassword,
      accessLookupFailed: access.lookupFailed,
    })
  }

  const response = NextResponse.redirect(new URL(redirectTo, origin))
  return response
}
