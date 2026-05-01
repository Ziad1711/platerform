import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/assistant/security'

export async function GET() {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const { data, error } = await supabase
      .from('profiles')
      .select('first_name, last_name, full_name, avatar_url, country, main_currency, preferred_currency, language, timezone, theme_preference')
      .eq('id', user.id)
      .maybeSingle()

    if (error) throw error

    return NextResponse.json({
      profile: data || null,
      email: user.email || '',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SETTINGS_PROFILE_FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      firstName?: string
      lastName?: string
      country?: string
    }

    const firstName = String(body.firstName || '').trim()
    const lastName = String(body.lastName || '').trim()
    const country = String(body.country || '').trim()
    const fullName = `${firstName} ${lastName}`.trim() || null

    const { error } = await supabase
      .from('profiles')
      .update({
        first_name: firstName || null,
        last_name: lastName || null,
        full_name: fullName,
        country: country || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SETTINGS_PROFILE_SAVE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
