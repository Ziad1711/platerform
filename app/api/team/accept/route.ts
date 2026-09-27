import { NextResponse } from 'next/server'
import { requireAuth, getServerClient } from '@/lib/auth/require-permission'
import { createAdminClient } from '@/lib/supabase/admin'

const INVITATION_ERROR_STATUS: Record<string, number> = {
  INVITATION_NOT_FOUND: 404,
  INVITATION_NOT_PENDING: 400,
  INVITATION_EXPIRED: 400,
  INVITATION_EMAIL_MISMATCH: 403,
}

export async function GET(request: Request) {
  try {
    const user = await requireAuth()
    const token = new URL(request.url).searchParams.get('token')?.trim() || ''

    const admin = createAdminClient()
    if (!token) {
      const { data: latest, error: latestError } = await admin
        .from('team_invitations')
        .select('email, token, status, expires_at')
        .eq('email', (user.email || '').toLowerCase())
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (latestError) throw latestError
      return NextResponse.json({ invitation: latest || null })
    }

    const { data: invitation, error } = await admin
      .from('team_invitations')
      .select('email, status, expires_at')
      .eq('token', token)
      .maybeSingle()

    if (error) throw error
    if (!invitation) {
      return NextResponse.json({ error: 'INVITATION_NOT_FOUND' }, { status: 404 })
    }

    return NextResponse.json({
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expires_at,
      matchesCurrentUser: invitation.email.toLowerCase() === (user.email || '').toLowerCase(),
      userEmail: user.email || '',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'INVITATION_FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth()
    const body = (await request.json().catch(() => ({}))) as { token?: string }
    const token = String(body.token || '').trim()

    if (!token) {
      return NextResponse.json({ error: 'TOKEN_REQUIRED' }, { status: 400 })
    }

    // L'acceptation est déléguée au RPC transactionnel `accept_team_invitation` :
    // il vérifie l'état, l'expiration et le destinataire de l'invitation, puis
    // la consomme et active les membres en une seule opération atomique.
    const supabase = await getServerClient()
    const { data, error } = await supabase.rpc('accept_team_invitation', { p_token: token })

    if (error) throw error

    const result = data as
      | { error?: string; assignments?: Array<{ store_id?: string; role?: string }> }
      | null

    if (!result || typeof result !== 'object') {
      return NextResponse.json({ error: 'ACCEPT_INVITATION_FAILED' }, { status: 500 })
    }

    if (result.error) {
      return NextResponse.json(
        { error: result.error },
        { status: INVITATION_ERROR_STATUS[result.error] ?? 400 }
      )
    }

    const assignments = Array.isArray(result.assignments) ? result.assignments : []
    const firstAssignment = assignments[0] || null

    return NextResponse.json({
      acceptedCount: assignments.length,
      storeId: firstAssignment?.store_id || null,
      role: firstAssignment?.role || null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ACCEPT_INVITATION_FAILED'
    console.error('[ACCEPT_INVITATION_ERROR]', message, error)
    const status = message === 'UNAUTHORIZED' ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
