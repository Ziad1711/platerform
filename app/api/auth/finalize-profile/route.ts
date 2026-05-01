import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/assistant/security'

export async function POST() {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const metadata = (user.user_metadata || {}) as Record<string, unknown>
    const firstName = String(metadata.first_name || '').trim()
    const lastName = String(metadata.last_name || '').trim()
    const fullName = String(metadata.full_name || `${firstName} ${lastName}` || '').trim()

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, full_name')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError) throw profileError

    const payload = {
      first_name: profile?.first_name || firstName || null,
      last_name: profile?.last_name || lastName || null,
      full_name: profile?.full_name || fullName || null,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase.from('profiles').upsert({ id: user.id, ...payload }, { onConflict: 'id' })
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FINALIZE_PROFILE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}