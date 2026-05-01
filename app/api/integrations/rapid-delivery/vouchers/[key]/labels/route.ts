import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import { downloadRapidDeliveryHtml } from '@/lib/integrations/rapid-delivery'
import { getDecryptedIntegrationToken } from '@/lib/integrations/rapid-delivery-connect'

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
      .from('rapid_delivery_entity_mappings')
      .select('integration_id, rapid_delivery_id')
      .eq('entity_type', 'voucher')
      .eq('rapid_delivery_id', voucherKey)
      .eq('user_id', user.id)
      .maybeSingle()

    if (mappingError) throw mappingError
    if (!mapping?.integration_id) {
      return NextResponse.json({ error: 'VOUCHER_NOT_FOUND' }, { status: 404 })
    }

    const token = await getDecryptedIntegrationToken(admin, mapping.integration_id)
    const html = await downloadRapidDeliveryHtml(token, `/vouchers/${encodeURIComponent(voucherKey)}/labels/v1/download`)

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="rapid-delivery-voucher-${voucherKey}-labels-v1.html"`,
      },
    })
  } catch (error) {
    console.error('Rapid Delivery voucher labels download error:', error)
    const message = error instanceof Error ? error.message : 'RAPID_DELIVERY_VOUCHER_LABELS_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}