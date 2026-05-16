const fs = require('fs');
const c2 = `import { NextResponse } from 'next/server'
import { requireAuth } from '/lib/auth/require-permission'
import { createAdminClient } from '/lib/supabase/admin'

interface Params {
  params: Promise<{ storeId: string; userId: string }>
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    await requireAuth()
    const { storeId, userId } = await params
    const body = (await request.json().catch(() => (({}))) as { role?: string }
    const role = String(body.role || '').trim()

    if (!role) {
      return NextResponse.json({ error: 'ROLE_REQUIRED' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { error } = await admin.rpc('change_member_role', {
      p_store_id: storeId,
      p_user_id: userId,
      p_new_role: role,
    })

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CHANGE_MEMBER_ROLE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    await requireAuth()
    const { storeId, userId } = await params

    const admin = createAdminClient()
    const { error } = await admin.rpc('remove_member', {
      p_store_id: storeId,
      p_user_id: userId,
    })

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'REMOVE_MEMBER_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
`;
fs.writeFileSync('app/api/team/members/[storeId]/[userId]/route.ts', c2);
console.log('done2');