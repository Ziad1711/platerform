import { NextResponse } from 'next/server'
import { getServerClient, requireAuth } from '@/lib/auth/require-permission'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasPermission, type Role } from '@/lib/auth/permissions'

/**
 * Autorisé uniquement au propriétaire du store ou à un membre actif dont le
 * rôle porte `stores.update` (owner / admin). La route écrit ensuite avec le
 * client service-role : la RLS ne s'applique plus, le contrôle doit donc être
 * fait explicitement ici, sur le store visé.
 */
async function assertCanUpdateStore(storeId: string, userId: string) {
  const admin = createAdminClient()

  const { data: store, error } = await admin
    .from('stores')
    .select('id, owner_user_id')
    .eq('id', storeId)
    .maybeSingle()

  if (error) throw error
  if (!store) throw new Error('STORE_NOT_FOUND')
  if (store.owner_user_id === userId) return

  const { data: member, error: memberError } = await admin
    .from('store_members')
    .select('role')
    .eq('store_id', storeId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()

  if (memberError) throw memberError

  const role = (member?.role ?? null) as Role | null
  if (!hasPermission(role, 'stores.update')) throw new Error('FORBIDDEN')
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth()
    const { id } = await params

    await assertCanUpdateStore(id, user.id)

    const admin = createAdminClient()

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
    const status = message.includes('UNAUTHORIZED')
      ? 401
      : message.includes('FORBIDDEN')
        ? 403
        : message.includes('STORE_NOT_FOUND')
          ? 404
          : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth()

    // Client lié à l'utilisateur : `delete_store` vérifie le propriétaire via auth.uid().
    const supabase = await getServerClient()
    const { id } = await params

    const { error } = await supabase.rpc('delete_store', {
      p_store_id: id,
    })

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'STORE_DELETE_FAILED'
    const status = message.includes('STORE_HAS_FINANCIAL_HISTORY')
      ? 409
      : message.includes('UNAUTHORIZED')
        ? 403
        : 500
    return NextResponse.json({ error: message }, { status })
  }
}
