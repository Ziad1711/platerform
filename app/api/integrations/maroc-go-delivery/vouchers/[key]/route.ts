import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import { getMarocGoDeliveryVoucher } from '@/lib/integrations/maroc-go-delivery'
import { getDecryptedIntegrationToken } from '@/lib/integrations/maroc-go-delivery-connect'

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    const { user } = await requireAuthenticatedUser()
    const { key } = await context.params
    const voucherKey = String(key || '').trim()
    if (!voucherKey) return NextResponse.json({ error: 'MISSING_VOUCHER_KEY' }, { status: 400 })

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

    const token = await getDecryptedIntegrationToken(admin, mapping.integration_id)
    const voucher = await getMarocGoDeliveryVoucher(token, voucherKey)
    const { data: orders, error: ordersError } = await admin
      .from('orders')
      .select('id, customer_name, phone, city, total_selling_price, maroc_go_delivery_parcel_key, maroc_go_delivery_voucher_key')
      .eq('store_id', mapping.store_id)
      .eq('maroc_go_delivery_voucher_key', voucherKey)
      .order('updated_at', { ascending: false })

    if (ordersError) throw ordersError
    return NextResponse.json({ ok: true, voucher, parcels: orders || [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MAROC_GO_DELIVERY_VOUCHER_FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
