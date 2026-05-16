import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-permission'
import { createAdminClient } from '@/lib/supabase/admin'

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
    const user = await requireAuth()
    const body = (await request.json().catch(() => ({}))) as { token?: string }
    const token = String(body.token || '').trim()

    if (!token) {
      return NextResponse.json({ error: 'TOKEN_REQUIRED' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: invitation, error: invitationError } = await admin
      .from('team_invitations')
      .select('email, status, expires_at')
      .eq('token', token)
      .maybeSingle()

    if (invitationError) throw invitationError
    if (!invitation || invitation.status !== 'pending' || new Date(invitation.expires_at) < new Date()) {
      return NextResponse.json({ error: 'INVITATION_INVALID_OR_EXPIRED' }, { status: 400 })
    }
    if (invitation.email.toLowerCase() !== (user.email || '').toLowerCase()) {
      return NextResponse.json({ error: 'INVITATION_EMAIL_MISMATCH' }, { status: 403 })
    }

    const { data: result, error } = await admin.rpc('accept_team_invitation', {
      p_token: token,
    })

    if (error) throw error
    if (result?.error) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    const assignments = Array.isArray(result?.assignments) ? result.assignments : []
    const firstAssignment = assignments[0] || null

    return NextResponse.json({
      acceptedCount: assignments.length,
      storeId: firstAssignment?.store_id || null,
      role: firstAssignment?.role || null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ACCEPT_INVITATION_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
