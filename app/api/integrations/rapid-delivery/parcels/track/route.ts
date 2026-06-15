import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import { getRapidDeliveryStateName, mapRapidDeliveryStateToOrderStatus, trackRapidDeliveryParcel } from '@/lib/integrations/rapid-delivery'
import { getDecryptedIntegrationToken } from '@/lib/integrations/rapid-delivery-connect'

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const { searchParams } = new URL(request.url)
    const orderId = String(searchParams.get('orderId') || '').trim()
    const trackingNumber = String(searchParams.get('trackingNumber') || '').trim()

    if (!trackingNumber) return NextResponse.json({ error: 'MISSING_TRACKING_NUMBER' }, { status: 400 })

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

    const token = await getDecryptedIntegrationToken(admin, integration.id)
    const payload = await trackRapidDeliveryParcel(token, trackingNumber)
    const stateName = getRapidDeliveryStateName(payload)
    const mapped = mapRapidDeliveryStateToOrderStatus(stateName)

    if (orderId) {
      // Ne pas synchroniser si la commande est déjà dans un état final ou confirmée (ex: confirmed)
      const { data: currentOrder } = await admin.from('orders').select('status').eq('id', orderId).single()
      const FINAL_ORDER_STATUSES = ['delivered', 'returned_not_stocked', 'returned_stocked', 'refused', 'confirmed']
      
      if (currentOrder && FINAL_ORDER_STATUSES.includes(currentOrder.status)) {
        return NextResponse.json({ ok: true, tracking: payload, mapped, skipped: true })
      }

      const now = new Date().toISOString()
      const updatePayload: Record<string, unknown> = {
        delivery_status: mapped.deliveryStatus,
        delivery_status_source: mapped.orderStatus ? 'delivery_company' : null,
        delivery_company_status_raw: mapped.rawStatus || null,
        last_delivery_sync_at: now,
        updated_at: now,
      }
      if (mapped.orderStatus) updatePayload.status = mapped.orderStatus
      if (mapped.orderStatus) updatePayload.last_status_update_at = now
      if (mapped.statusDateField) updatePayload[mapped.statusDateField] = now

      const { error } = await supabase.from('orders').update(updatePayload).eq('id', orderId)
      if (error) throw error
    }

    return NextResponse.json({ ok: true, tracking: payload, mapped })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RAPID_DELIVERY_TRACK_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}