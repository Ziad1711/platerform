import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-permission'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  try {
    const user = await requireAuth()
    const admin = createAdminClient()

    const { data, error } = await admin
      .from('team_invitations')
      .select(`
        *,
        team_invitation_assignments (
          *,
          stores (*)
        )
      `)
      .eq('invited_by', user.id)
      .eq('status', 'pending')

    if (error) throw error

    const invitations = (data || []).map((inv: any) => ({
      ...inv,
      assignments: (inv.team_invitation_assignments || []).map((a: any) => ({
        store_id: a.store_id,
        store_name: a.stores?.name || '',
        role: a.role,
      })),
    }))

    return NextResponse.json({ invitations })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FETCH_INVITATIONS_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}