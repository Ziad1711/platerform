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