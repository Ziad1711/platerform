import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import { getAmeexCredentials } from '@/lib/integrations/ameex-credentials'
import { downloadAmeexLabelsHtml } from '@/lib/integrations/ameex'

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    const { user } = await requireAuthenticatedUser()
    const { key } = await context.params
    const voucherKey = String(key || '').trim()
    if (!voucherKey) {
      return NextResponse.json({ error: 'MISSING_VOUCHER_KEY' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Trouver l'intégration AMEEX liée à ce voucher via les commandes
    const { data: orders, error: ordersError } = await admin
      .from('orders')
      .select('store_id')
      .eq('ameex_delivery_note_ref', voucherKey)
      .limit(1)

    if (ordersError) throw ordersError
    if (!orders || orders.length === 0) {
      return NextResponse.json({ error: 'VOUCHER_NOT_FOUND' }, { status: 404 })
    }

    const storeId = orders[0].store_id

    // Récupérer l'intégration AMEEX pour ce store
    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id')
      .eq('provider', 'ameex')
      .eq('store_id', storeId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration) {
      return NextResponse.json({ error: 'AMEEX_NOT_CONNECTED' }, { status: 400 })
    }

    const credentials = await getAmeexCredentials(admin, integration.id)
    const raw = await downloadAmeexLabelsHtml(credentials.apiId, credentials.apiKey, voucherKey)

    // L'API AMEEX retourne un JSON encapsulé : { login, api: { data: { html: "..." } } }
    let html = raw
    try {
      const parsed = JSON.parse(raw)
      if (parsed?.api?.data?.html) {
        html = parsed.api.data.html
      }
    } catch {
      // si ce n'est pas du JSON, on utilise le brut
    }

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="ameex-etiquettes-${voucherKey}.html"`,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AMEEX_VOUCHER_LABELS_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
