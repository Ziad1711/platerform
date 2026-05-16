import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/assistant/security'

export async function GET() {
  try {
    const { supabase, user } = await requireAuthenticatedUser()

    const { data: invitation } = await supabase
      .from('team_invitations')
      .select('token, email, status, expires_at')
      .eq('email', user.email || '')
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .maybeSingle()

    return NextResponse.json({ invitation: invitation || null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FETCH_FAILED'
    console.error('[PENDING_INVITATION_ERROR]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
