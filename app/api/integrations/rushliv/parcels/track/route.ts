import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { getRushlivStateName, mapRushlivStateToOrderStatus, trackRushlivParcel } from '@/lib/integrations/rushliv'
import { getDecryptedIntegrationToken } from '@/lib/integrations/rushliv-connect'
import { resolveStoreIntegration } from '@/lib/integrations/delivery/resolve-store-integration'
import {
  EXCHANGE_RETURN_ORDER_STATUS,
  EXCHANGE_STATUS_COMPLETED,
  isExchangeActive,
  isExchangeFollowUpOrder,
} from '@/lib/integrations/delivery/exchange-providers'

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const { searchParams } = new URL(request.url)
    const orderId = String(searchParams.get('orderId') || '').trim()
    const trackingNumber = String(searchParams.get('trackingNumber') || '').trim()

    if (!trackingNumber) return NextResponse.json({ error: 'MISSING_TRACKING_NUMBER' }, { status: 400 })

    const admin = createAdminClient()
    let orderStoreId = ''

    // Le suivi n'est autorisé que sur le colis de la commande visée : sans ce
    // contrôle, n'importe quel numéro de suivi permettrait d'écraser le statut
    // d'une commande d'un autre store.
    if (orderId) {
      const { data: orderRow, error: orderRowError } = await admin
        .from('orders')
        .select('store_id, tracking_number, external_delivery_id, rushliv_parcel_key')
        .eq('id', orderId)
        .maybeSingle()

      if (orderRowError) throw orderRowError
      if (!orderRow) return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })

      const ownTrackingNumbers = [orderRow.rushliv_parcel_key, orderRow.tracking_number, orderRow.external_delivery_id]
        .map((value) => String(value || '').trim())
        .filter(Boolean)

      if (!ownTrackingNumbers.includes(trackingNumber)) {
        return NextResponse.json({ error: 'TRACKING_NUMBER_MISMATCH' }, { status: 400 })
      }

      orderStoreId = String(orderRow.store_id || '')
      await verifyStoreAccess(supabase, user.id, orderStoreId)
    }

    let integration: { id: string; status: string } | null = null

    if (orderStoreId) {
      integration = await resolveStoreIntegration(admin, 'rushliv', orderStoreId)
    } else {
      const { data: ownIntegration, error: ownIntegrationError } = await admin
        .from('integrations')
        .select('id, status')
        .eq('user_id', user.id)
        .eq('provider', 'rushliv')
        .maybeSingle()

      if (ownIntegrationError) throw ownIntegrationError

      integration = ownIntegration
        ? { id: String(ownIntegration.id), status: String(ownIntegration.status) }
        : null
    }

    if (!integration || integration.status !== 'connected') {
      return NextResponse.json({ error: 'RUSHLIV_NOT_CONNECTED' }, { status: 400 })
    }

    const token = await getDecryptedIntegrationToken(admin, integration.id)
    const payload = await trackRushlivParcel(token, trackingNumber)
    const mapped = mapRushlivStateToOrderStatus(getRushlivStateName(payload))

    if (orderId) {
      const { data: currentOrder } = await admin
        .from('orders')
        .select('status, exchange_status, exchange_original_order_id')
        .eq('id', orderId)
        .single()

      const FINAL_ORDER_STATUSES = ['delivered', 'returned_not_stocked', 'returned_stocked', 'refused', 'confirmed']

      if (currentOrder && FINAL_ORDER_STATUSES.includes(String(currentOrder.status || '')) && !isExchangeFollowUpOrder(currentOrder)) {
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
      if (mapped.orderStatus) {
        updatePayload.status = mapped.orderStatus
        updatePayload.last_status_update_at = now
      }
      if (mapped.statusDateField) updatePayload[mapped.statusDateField] = now

      if (mapped.orderStatus === EXCHANGE_RETURN_ORDER_STATUS && isExchangeActive(currentOrder?.exchange_status)) {
        updatePayload.exchange_status = EXCHANGE_STATUS_COMPLETED
        updatePayload.exchange_completed_at = now
      }

      const { error } = await supabase.from('orders').update(updatePayload).eq('id', orderId)
      if (error) throw error
    }

    return NextResponse.json({ ok: true, tracking: payload, mapped })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RUSHLIV_TRACK_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
