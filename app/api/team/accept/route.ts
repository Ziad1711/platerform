import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-permission'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  try {
    await requireAuth()
    const body = (await request.json().catch(() => ({}))) as { token?: string }
    const token = String(body.token || '').trim()

    if (!token) {
      return NextResponse.json({ error: 'TOKEN_REQUIRED' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: result, error } = await admin.rpc('accept_team_invitation', {
      p_token: token,
    })

    if (error) throw error
    return NextResponse.json({ acceptedCount: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ACCEPT_INVITATION_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
