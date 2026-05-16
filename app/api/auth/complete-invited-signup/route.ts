import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string
      password?: string
      firstName?: string
      lastName?: string
      token?: string
    }

    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    const firstName = String(body.firstName || '').trim()
    const lastName = String(body.lastName || '').trim()
    const token = String(body.token || '').trim()

    if (!email || !password || !token) {
      return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'PASSWORD_TOO_SHORT' }, { status: 400 })
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
    if (invitation.email.toLowerCase() !== email) {
      return NextResponse.json({ error: 'INVITATION_EMAIL_MISMATCH' }, { status: 403 })
    }

    const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    })
    if (usersError) throw usersError

    const user = usersData.users.find((item) => item.email?.toLowerCase() === email)
    if (!user) {
      return NextResponse.json({ error: 'INVITED_USER_NOT_FOUND' }, { status: 404 })
    }

    const fullName = `${firstName} ${lastName}`.trim()
    const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
      password,
      user_metadata: {
        ...user.user_metadata,
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
        password_set: true,
      },
    })
    if (updateError) throw updateError

    const { error: profileError } = await admin.from('profiles').upsert(
      {
        id: user.id,
        first_name: firstName || null,
        last_name: lastName || null,
        full_name: fullName || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
    if (profileError) throw profileError

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'COMPLETE_INVITED_SIGNUP_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
