import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import { getDecryptedIntegrationToken } from '@/lib/integrations/maroc-go-delivery-connect'
import { getMarocGoDeliveryStateName, mapMarocGoDeliveryStateToOrderStatus, trackMarocGoDeliveryParcel } from '@/lib/integrations/maroc-go-delivery'
import {
  EXCHANGE_ACTIVE_STATUSES,
  EXCHANGE_RETURN_ORDER_STATUS,
  EXCHANGE_STATUS_COMPLETED,
  isExchangeActive,
  isExchangeFollowUpOrder,
} from '@/lib/integrations/delivery/exchange-providers'

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
      .eq('provider', 'maroc-go-delivery')
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration || integration.status !== 'connected') {
      return NextResponse.json({ error: 'MAROC_GO_DELIVERY_NOT_CONNECTED' }, { status: 400 })
    }

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
      .eq('api_provider', 'maroc-go-delivery')

    if (deliveryCompaniesError) throw deliveryCompaniesError
    const deliveryCompanyIds = (deliveryCompanies || []).map((company) => company.id).filter(Boolean)
    if (deliveryCompanyIds.length === 0) return NextResponse.json({ synced: 0, errors: 0 })

    // Les commandes habituellement exclues restent exclues, sauf si elles sont
    // engagées dans un échange ou en sont la commande de remplacement.
    const excludedList = EXCLUDED_ORDER_STATUSES.map((status) => `"${status}"`).join(',')
    const activeExchangeList = EXCHANGE_ACTIVE_STATUSES.map((status) => `"${status}"`).join(',')
    const syncFilter = [
      `status.not.in.(${excludedList})`,
      `exchange_status.in.(${activeExchangeList})`,
      'exchange_original_order_id.not.is.null',
    ].join(',')

    const buildOrdersQuery = (withFilter: boolean) => {
      let query = admin
        .from('orders')
        .select('id, maroc_go_delivery_parcel_key, status, exchange_status, exchange_original_order_id')
        .eq('store_id', storeId)
        .in('delivery_company_id', deliveryCompanyIds)
        .not('maroc_go_delivery_parcel_key', 'is', null)

      if (withFilter) query = query.or(syncFilter)
      return query
    }

    let ordersResult = await buildOrdersQuery(true)

    // Filet de sécurité : si le filtre PostgREST est refusé, on retombe sur un
    // filtrage JavaScript (le garde-fou dans la boucle reste actif).
    if (ordersResult.error) {
      console.warn('Maroc Go Delivery sync-all: filtre SQL indisponible, repli JS', ordersResult.error.message)
      ordersResult = await buildOrdersQuery(false)
    }

    if (ordersResult.error) throw ordersResult.error
    const orders = ordersResult.data

    let synced = 0
    let errors = 0

    for (const order of orders || []) {
      try {
        // Une commande engagée dans un échange (ou sa commande de remplacement)
        // doit rester suivie pour récupérer l'état « Retour/Echange ».
        if (EXCLUDED_ORDER_STATUSES.includes(String(order.status || '')) && !isExchangeFollowUpOrder(order)) continue

        const trackingNumber = String(order.maroc_go_delivery_parcel_key || '').trim()
        if (!trackingNumber) continue

        const payload = await trackMarocGoDeliveryParcel(token, trackingNumber)
        const mapped = mapMarocGoDeliveryStateToOrderStatus(getMarocGoDeliveryStateName(payload))
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

        // Le retour est confirmé : l'échange n'a plus besoin d'être suivi.
        if (mapped.orderStatus === EXCHANGE_RETURN_ORDER_STATUS && isExchangeActive(order.exchange_status)) {
          updatePayload.exchange_status = EXCHANGE_STATUS_COMPLETED
          updatePayload.exchange_completed_at = now
        }

        const { error: updateError } = await admin.from('orders').update(updatePayload).eq('id', order.id)
        if (updateError) throw updateError
        synced += 1
      } catch (error) {
        console.error('Maroc Go Delivery sync-all order failed', {
          orderId: order.id,
          trackingNumber: order.maroc_go_delivery_parcel_key,
          error: error instanceof Error ? error.message : error,
        })
        errors += 1
      }
    }

    return NextResponse.json({ synced, errors })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MAROC_GO_DELIVERY_SYNC_ALL_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
