import { NextResponse } from 'next/server'
import { assertTrustedOrigin, requireAuthenticatedUser } from '@/lib/assistant/security'

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()

    if (!user.email) {
      return NextResponse.json({ error: 'USER_EMAIL_NOT_FOUND' }, { status: 400 })
    }

    const origin = new URL(request.url).origin
    const redirectTo = `${origin.replace(/\/$/, '')}/login?recovery=1`
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo })
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SETTINGS_PASSWORD_RESET_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
