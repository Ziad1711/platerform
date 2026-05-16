import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-permission'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendInvitationEmail } from '@/lib/email/invitations'
import { randomBytes } from 'crypto'

export async function POST(request: Request) {
  try {
    const user = await requireAuth()
    const admin = createAdminClient()

    const body = (await request.json().catch(() => ({}))) as {
      email?: string
      assignments?: Array<{ storeId: string; role: string }>
    }

    const email = String(body.email || '').trim().toLowerCase()
    const assignments = Array.isArray(body.assignments) ? body.assignments : []

    if (!email) {
      return NextResponse.json({ error: 'EMAIL_REQUIRED' }, { status: 400 })
    }
    if (assignments.length === 0) {
      return NextResponse.json({ error: 'ASSIGNMENTS_REQUIRED' }, { status: 400 })
    }

    // 1) Verify current user is admin/owner for each store in assignments
    const storeIds = assignments.map((a) => a.storeId)
    const { data: myRoles, error: rolesError } = await admin
      .from('store_members')
      .select('store_id, role')
      .eq('user_id', user.id)
      .in('store_id', storeIds)
      .in('role', ['owner', 'admin'])
      .eq('status', 'active')

    if (rolesError) throw rolesError

    const allowedStoreIds = new Set((myRoles || []).map((r) => r.store_id))
    for (const a of assignments) {
      if (!allowedStoreIds.has(a.storeId)) {
        return NextResponse.json(
          { error: 'FORBIDDEN', storeId: a.storeId },
          { status: 403 }
        )
      }
    }

    // 2) Generate token
    const token = randomBytes(16).toString('hex')

    // 3) Insert into team_invitations
    const { data: invitation, error: inviteError } = await admin
      .from('team_invitations')
      .insert({
        email,
        token,
        invited_by: user.id,
        status: 'pending',
      })
      .select('id')
      .single()

    if (inviteError) throw inviteError
    if (!invitation) throw new Error('INVITATION_INSERT_FAILED')

    // 4) Insert assignments into team_invitation_assignments
    const assignmentRows = assignments.map((a) => ({
      invitation_id: invitation.id,
      store_id: a.storeId,
      role: a.role,
    }))

    const { error: assignError } = await admin
      .from('team_invitation_assignments')
      .insert(assignmentRows)

    if (assignError) throw assignError

    // Fetch store names for email
    const { data: storesData } = await admin
      .from('stores')
      .select('id, name')
      .in('id', storeIds)

    const storeNameMap: Record<string, string> = {}
    for (const s of storesData || []) {
      storeNameMap[s.id] = s.name
    }
    const storeNames = assignments.map((a) => storeNameMap[a.storeId] || a.storeId)

    // 5) Send invitation email
    const emailResult = await sendInvitationEmail(email, token, {
      inviterName: user.email || undefined,
      storeNames,
    })

    return NextResponse.json({ success: true, emailMethod: emailResult.method })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'INVITE_FAILED'
    console.error('[TEAM_INVITE_ERROR]', message, error)
    const status =
      message === 'UNAUTHORIZED' ? 401 : message === 'FORBIDDEN' ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
