import { NextResponse } from 'next/server'
import { requireAuth, getServerClient } from '@/lib/auth/require-permission'

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ storeId: string; userId: string }> }
) {
  try {
    await requireAuth()
    const { storeId, userId } = await params
    const body = (await _request.json().catch(() => ({ role: '' }))) as { role: string }
    const newRole = String(body.role || '').trim()
    if (!newRole) return NextResponse.json({ error: 'ROLE_REQUIRED' }, { status: 400 })

    const supabase = await getServerClient()
    const { error } = await supabase.rpc('change_member_role', {
      p_store_id: storeId,
      p_user_id: userId,
      p_new_role: newRole,
    })
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UPDATE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ storeId: string; userId: string }> }
) {
  try {
    await requireAuth()
    const { storeId, userId } = await params
    const supabase = await getServerClient()
    const { error } = await supabase.rpc('remove_member', {
      p_store_id: storeId,
      p_user_id: userId,
    })
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'REMOVE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
