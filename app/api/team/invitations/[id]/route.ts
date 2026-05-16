import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-permission'
import { createAdminClient } from '@/lib/supabase/admin'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth()
    const admin = createAdminClient()
    const { id } = await params

    const { data, error } = await admin
      .from('team_invitations')
      .update({ status: 'revoked' })
      .eq('id', id)
      .eq('invited_by', user.id)
      .select()

    if (error) throw error
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND_OR_UNAUTHORIZED' }, { status: 404 })
    }

    return NextResponse.json({ invitation: data[0] })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'REVOKE_INVITATION_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
