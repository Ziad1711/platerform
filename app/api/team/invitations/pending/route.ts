import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-permission'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  try {
    const user = await requireAuth()

    const { data: invitation, error } = await createAdminClient()
      .from('team_invitations')
      .select('token, email, status, expires_at')
      .eq('email', (user.email || '').toLowerCase())
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error

    return NextResponse.json({ invitation: invitation || null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FETCH_FAILED'
    console.error('[PENDING_INVITATION_ERROR]', message)
    // Configuration serveur incomplète (clé service absente) : état explicite,
    // distinct d'une erreur métier. Aucun nom de variable technique n'est renvoyé.
    if (message === 'MISSING_SUPABASE_ADMIN_CONFIG') {
      return NextResponse.json({ error: 'INVITATION_LOOKUP_UNAVAILABLE' }, { status: 503 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
