import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json()) as { storeId: string }
    const { storeId } = body

    if (!storeId) {
      return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    }

    await verifyStoreAccess(supabase, user.id, storeId)

    const admin = createAdminClient()

    // 1. Supprimer la config
    await admin.from('digylog_configs').delete().eq('store_id', storeId)

    // 2. Supprimer le webhook chez Digylog puis désactiver l'intégration
    const { data: integration } = await supabase
      .from('integrations')
      .select('id, access_token')
      .eq('user_id', user.id)
      .eq('provider', 'digylog')
      .eq('store_id', storeId)
      .maybeSingle()

    if (integration?.access_token) {
      try {
        await fetch('https://api.digylog.com/api/v2/seller/webhook', {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${integration.access_token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Referer: 'https://apiseller.digylog.com',
          },
        })
      } catch {
        // Non bloquant
      }
    }

    if (integration?.id) {
      await supabase.from('integrations').update({ status: 'disconnected', access_token: null, updated_at: new Date().toISOString() }).eq('id', integration.id)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'DIGYLOG_DISCONNECT_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
