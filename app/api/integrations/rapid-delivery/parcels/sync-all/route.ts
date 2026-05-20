import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import { getRapidDeliveryIntegrationCredentials } from '@/lib/integrations/rapid-delivery-connect'
import { getRapidDeliveryStateName, mapRapidDeliveryStateToOrderStatus, trackRapidDeliveryParcel } from '@/lib/integrations/rapid-delivery'

const FINAL_ORDER_STATUSES = ['delivered', 'returned_not_stocked', 'returned_stocked', 'refused']

export async function POST() {
  try {
    const { user } = await requireAuthenticatedUser()
    const admin = createAdminClient()

    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('provider', 'rapid-delivery')
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration || integration.status !== 'connected') {
      return NextResponse.json({ error: 'RAPID_DELIVERY_NOT_CONNECTED' }, { status: 400 })
    }

    const { token, baseUrl } = await getRapidDeliveryIntegrationCredentials(admin, integration.id)
    const { data: orders, error: ordersError } = await admin
      .from('orders')
      .select('id, tracking_number, status')
      .not('tracking_number', 'is', null)
      .not('tracking_number', 'eq', '')
      .not('status', 'in', `(${FINAL_ORDER_STATUSES.map((status) => `"${status}"`).join(',')})`)

    if (ordersError) throw ordersError

    let synced = 0
    let errors = 0

    for (const order of orders || []) {
      try {
        const trackingNumber = String(order.tracking_number || '').trim()
        if (!trackingNumber) continue

        const payload = await trackRapidDeliveryParcel(token, trackingNumber, baseUrl)
        const mapped = mapRapidDeliveryStateToOrderStatus(getRapidDeliveryStateName(payload))
        const now = new Date().toISOString()
        const updatePayload: Record<string, unknown> = {
          delivery_status: mapped.deliveryStatus,
          delivery_status_source: mapped.orderStatus ? 'delivery_company' : null,
          delivery_company_status_raw: mapped.rawStatus || null,
          last_delivery_sync_at: now,
          updated_at: now,
        }

        if (mapped.orderStatus) {
          updatePayload.status = mapped.orderStatus
          updatePayload.last_status_update_at = now
        }

        if (mapped.statusDateField) {
          updatePayload[mapped.statusDateField] = now
        }

        const { error: updateError } = await admin.from('orders').update(updatePayload).eq('id', order.id)
        if (updateError) throw updateError
        synced += 1
      } catch (error) {
        console.error('Rapid Delivery sync-all order failed', {
          orderId: order.id,
          trackingNumber: order.tracking_number,
          error: error instanceof Error ? error.message : error,
        })
        errors += 1
      }
    }

    return NextResponse.json({ synced, errors })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RAPID_DELIVERY_SYNC_ALL_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}