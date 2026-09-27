import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import { downloadMarocGoDeliveryHtml } from '@/lib/integrations/maroc-go-delivery'
import { getDecryptedIntegrationToken } from '@/lib/integrations/maroc-go-delivery-connect'

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    const { user } = await requireAuthenticatedUser()
    const { key } = await context.params
    const voucherKey = String(key || '').trim()
    if (!voucherKey) {
      return NextResponse.json({ error: 'MISSING_VOUCHER_KEY' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: mapping, error: mappingError } = await admin
      .from('delivery_entity_mappings')
      .select('integration_id, store_id, provider_entity_id')
      .eq('entity_type', 'voucher')
      .eq('provider_entity_id', voucherKey)
      .eq('user_id', user.id)
      .maybeSingle()

    if (mappingError) throw mappingError
    if (!mapping?.integration_id) {
      return NextResponse.json({ error: 'VOUCHER_NOT_FOUND' }, { status: 404 })
    }

    // Le bon n'est accessible qu'aux membres encore actifs de son store.
    const voucherStoreId = String(mapping.store_id || '')
    if (!voucherStoreId) return NextResponse.json({ error: 'VOUCHER_NOT_FOUND' }, { status: 404 })

    const { data: membership, error: membershipError } = await admin
      .from('store_members')
      .select('store_id')
      .eq('user_id', user.id)
      .eq('store_id', voucherStoreId)
      .eq('status', 'active')
      .maybeSingle()

    if (membershipError) throw membershipError
    if (!membership) return NextResponse.json({ error: 'STORE_ACCESS_DENIED' }, { status: 403 })

    const token = await getDecryptedIntegrationToken(admin, mapping.integration_id)

    // Le bon de ramassage est servi au format HTML imprimable
    const html = await downloadMarocGoDeliveryHtml(token, `/vouchers/${encodeURIComponent(voucherKey)}/download`)

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="maroc-go-delivery-voucher-${voucherKey}.html"`,
      },
    })
  } catch (error) {
    console.error('Maroc Go Delivery voucher download error:', error)
    const message = error instanceof Error ? error.message : 'MAROC_GO_DELIVERY_VOUCHER_DOWNLOAD_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
