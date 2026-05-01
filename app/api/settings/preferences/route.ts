import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/assistant/security'

export async function GET() {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const { data, error } = await supabase
      .from('profiles')
      .select('preferred_currency, language, timezone, theme_preference')
      .eq('id', user.id)
      .maybeSingle()

    if (error) throw error
    return NextResponse.json({ preferences: data || null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SETTINGS_PREFERENCES_FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      preferredCurrency?: string
      language?: string
      timezone?: string
      themePreference?: 'light' | 'dark' | 'system'
    }

    const preferredCurrency = String(body.preferredCurrency || '').trim().toUpperCase()
    const language = String(body.language || 'fr').trim().toLowerCase()
    const timezone = String(body.timezone || 'Africa/Casablanca').trim()
    const themePreference = String(body.themePreference || 'system').trim()

    if (preferredCurrency && preferredCurrency.length !== 3) {
      return NextResponse.json({ error: 'INVALID_PREFERRED_CURRENCY' }, { status: 400 })
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        preferred_currency: preferredCurrency || null,
        language,
        timezone,
        theme_preference: themePreference,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SETTINGS_PREFERENCES_SAVE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
