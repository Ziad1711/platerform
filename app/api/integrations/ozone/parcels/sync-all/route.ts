import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import { ozoneAdapter } from '@/lib/integrations/delivery/ozone-adapter'
import { createDeliveryLogger } from '@/lib/integrations/delivery/logger'
import { trackAndUpdateOrder } from '@/lib/integrations/delivery/tracking-service'

const EXCLUDED_ORDER_STATUSES = ['new', 'delivered', 'returned_not_stocked', 'returned_stocked', 'refused', 'confirmed']

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuthenticatedUser()
    const admin = createAdminClient()
    const body = (await request.json().catch(() => ({}))) as { storeId?: string; store_id?: string }
    const storeId = String(body.storeId || body.store_id || request.cookies.get('current-store-id')?.value || '').trim()

    if (!storeId) {
      return NextResponse.json({ error: 'STORE_REQUIRED' }, { status: 400 })
    }

    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('provider', 'ozone')
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration || integration.status !== 'connected') {
      return NextResponse.json({ error: 'OZONE_NOT_CONNECTED' }, { status: 400 })
    }

    const { getDecryptedIntegrationToken } = await import('@/lib/integrations/rapid-delivery-connect')
    const token = await getDecryptedIntegrationToken(admin, integration.id)

    const { data: membership, error: membershipError } = await admin
      .from('store_members')
      .select('store_id')
      .eq('user_id', user.id)
      .eq('store_id', storeId)
      .maybeSingle()

    if (membershipError) throw membershipError
    if (!membership) return NextResponse.json({ error: 'STORE_ACCESS_DENIED' }, { status: 403 })

    const { data: deliveryCompanies, error: deliveryCompaniesError } = await admin
      .from('delivery_companies')
      .select('id')
      .eq('store_id', storeId)
      .eq('api_provider', 'ozone')

    if (deliveryCompaniesError) throw deliveryCompaniesError
    const deliveryCompanyIds = (deliveryCompanies || []).map((company) => company.id).filter(Boolean)
    if (deliveryCompanyIds.length === 0) return NextResponse.json({ synced: 0, errors: 0 })

    const { data: orders, error: ordersError } = await admin
      .from('orders')
      .select('id, tracking_number, status')
      .eq('store_id', storeId)
      .in('delivery_company_id', deliveryCompanyIds)
      .not('tracking_number', 'is', null)
      .not('tracking_number', 'eq', '')
      .not('status', 'in', `(${EXCLUDED_ORDER_STATUSES.map((status) => `"${status}"`).join(',')})`)

    if (ordersError) throw ordersError

    let synced = 0
    let errors = 0
    const logger = createDeliveryLogger({ admin, integrationId: integration.id, storeId, userId: user.id })

    for (const order of orders || []) {
      try {
        const trackingNumber = String(order.tracking_number || '').trim()
        if (!trackingNumber) continue

        await trackAndUpdateOrder({
          admin,
          provider: ozoneAdapter,
          config: { integrationId: integration.id, token, baseUrl: null, userId: user.id, storeId },
          trackingNumber,
          orderId: order.id,
          logger,
        })
        synced += 1
      } catch (error) {
        console.error('OZONE sync-all order failed', {
          orderId: order.id,
          trackingNumber: order.tracking_number,
          error: error instanceof Error ? error.message : error,
        })
        errors += 1
      }
    }

    return NextResponse.json({ synced, errors })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OZONE_SYNC_ALL_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
