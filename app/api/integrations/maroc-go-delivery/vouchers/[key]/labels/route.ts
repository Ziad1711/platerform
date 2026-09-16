import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import { downloadMarocGoDeliveryHtml } from '@/lib/integrations/maroc-go-delivery'
import { getDecryptedIntegrationToken } from '@/lib/integrations/maroc-go-delivery-connect'

const LABEL_VERSIONS = ['v1', 'v2', 'v3']

export async function GET(request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    const { user } = await requireAuthenticatedUser()
    const { key } = await context.params
    const voucherKey = String(key || '').trim()
    if (!voucherKey) {
      return NextResponse.json({ error: 'MISSING_VOUCHER_KEY' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const requestedVersion = String(searchParams.get('version') || '').trim().toLowerCase()
    const version = LABEL_VERSIONS.includes(requestedVersion) ? requestedVersion : 'v1'

    const admin = createAdminClient()
    const { data: mapping, error: mappingError } = await admin
      .from('delivery_entity_mappings')
      .select('integration_id, provider_entity_id')
      .eq('entity_type', 'voucher')
      .eq('provider_entity_id', voucherKey)
      .eq('user_id', user.id)
      .maybeSingle()

    if (mappingError) throw mappingError
    if (!mapping?.integration_id) {
      return NextResponse.json({ error: 'VOUCHER_NOT_FOUND' }, { status: 404 })
    }

    const token = await getDecryptedIntegrationToken(admin, mapping.integration_id)
    const html = await downloadMarocGoDeliveryHtml(token, `/vouchers/${encodeURIComponent(voucherKey)}/labels/${version}/download`)

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="maroc-go-delivery-voucher-${voucherKey}-labels-${version}.html"`,
      },
    })
  } catch (error) {
    console.error('Maroc Go Delivery voucher labels download error:', error)
    const message = error instanceof Error ? error.message : 'MAROC_GO_DELIVERY_VOUCHER_LABELS_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
