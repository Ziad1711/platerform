import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-permission'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth()
    const admin = createAdminClient()
    const { id } = await params

    const body = await request.json().catch(() => ({}))
    const allowedFields = ['name', 'logo_url', 'currency', 'country', 'website']

    const updates: Record<string, unknown> = {}
    for (const key of allowedFields) {
      if (key in body) {
        updates[key] = body[key]
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'NO_FIELDS_TO_UPDATE' },
        { status: 400 }
      )
    }

    const { data, error } = await admin
      .from('stores')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ store: data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'STORE_UPDATE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth()
    const admin = createAdminClient()
    const { id } = await params

    const { error } = await admin.rpc('delete_store', {
      p_store_id: id,
    })

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'STORE_DELETE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
