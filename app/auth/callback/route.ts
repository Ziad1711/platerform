import { NextResponse } from 'next/server'
import { sanitizeInternalRedirectPath } from '@/lib/assistant/security'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = sanitizeInternalRedirectPath(url.searchParams.get('next'), '/dashboard')
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

  return NextResponse.redirect(new URL(next, origin))
}