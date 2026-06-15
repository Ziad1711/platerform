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
    
    // On cherche d'abord dans la table unifiée
    let { data: mapping } = await admin
      .from('delivery_entity_mappings')
      .select('integration_id, provider_entity_id')
      .eq('entity_type', 'voucher')
      .eq('provider_entity_id', voucherKey)
      .eq('user_id', user.id)
      .maybeSingle()

    // Sinon dans la table legacy
    if (!mapping) {
        const { data: legacyMapping } = await admin
          .from('rapid_delivery_entity_mappings')
          .select('integration_id, rapid_delivery_id')
          .eq('entity_type', 'voucher')
          .eq('rapid_delivery_id', voucherKey)
          .eq('user_id', user.id)
          .maybeSingle()
        
        if (legacyMapping) {
            mapping = { 
                integration_id: legacyMapping.integration_id, 
                provider_entity_id: legacyMapping.rapid_delivery_id 
            } as any
        }
    }

    if (!mapping?.integration_id) {
      return NextResponse.json({ error: 'VOUCHER_NOT_FOUND' }, { status: 404 })
    }

    const token = await getDecryptedIntegrationToken(admin, mapping.integration_id)
    
    // Pour Rapid Delivery, le bon de ramassage est servi au format HTML imprimable
    const html = await downloadRapidDeliveryHtml(token, `/vouchers/${encodeURIComponent(voucherKey)}/download`)

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="rapid-delivery-voucher-${voucherKey}.html"`,
      },
    })
  } catch (error) {
    console.error('Rapid Delivery voucher download error:', error)
    const message = error instanceof Error ? error.message : 'RAPID_DELIVERY_VOUCHER_DOWNLOAD_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
