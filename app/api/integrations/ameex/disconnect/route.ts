import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser } from '@/lib/assistant/security'

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as { storeId?: string }
    const storeId = String(body.storeId || '').trim()

    if (!storeId) return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })

    const admin = createAdminClient()

    // Vérifier que l'utilisateur est membre actif du store ciblé
    const { data: membership, error: membershipError } = await admin
      .from('store_members')
      .select('store_id')
      .eq('user_id', user.id)
      .eq('store_id', storeId)
      .eq('status', 'active')
      .maybeSingle()

    if (membershipError) throw membershipError
    if (!membership) return NextResponse.json({ error: 'STORE_ACCESS_DENIED' }, { status: 403 })

    // Delete ameex_configs
    await admin.from('ameex_configs').delete().eq('store_id', storeId)

    // Delete store_integrations
    await admin.from('store_integrations').delete().eq('store_id', storeId).eq('provider_slug', 'ameex')

    // Delete integrations
    const { data: integration } = await admin
      .from('integrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'ameex')
      .eq('store_id', storeId)
      .maybeSingle()

    if (integration?.id) {
      await admin.from('integrations').delete().eq('id', integration.id)
    }

    // Desactiver delivery_company
    await admin
      .from('delivery_companies')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('store_id', storeId)
      .eq('api_provider', 'ameex')

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AMEEX_DISCONNECT_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}