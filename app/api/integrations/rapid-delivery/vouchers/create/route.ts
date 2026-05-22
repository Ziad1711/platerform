import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { createRapidDeliveryVoucher } from '@/lib/integrations/rapid-delivery'
import { getDecryptedIntegrationToken, resolveDefaultRapidDeliveryShopKey } from '@/lib/integrations/rapid-delivery-connect'

function toRapidDeliveryVoucherErrorMessage(error: unknown) {
  console.error('Rapid Delivery voucher create error:', error)

  const fallbackMessage = 'RAPID_DELIVERY_CREATE_VOUCHER_FAILED'
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
      ? error.message
      : fallbackMessage
  const details = typeof error === 'object' && error !== null && 'details' in error && typeof error.details === 'string'
    ? error.details.trim()
    : ''
  const hint = typeof error === 'object' && error !== null && 'hint' in error && typeof error.hint === 'string'
    ? error.hint.trim()
    : ''

  return [message, details, hint].filter(Boolean).join(' | ') || fallbackMessage
}

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as { storeId?: string; orderIds?: string[] }
    const storeId = String(body.storeId || '').trim()
    const orderIds = Array.isArray(body.orderIds) ? body.orderIds.map((value) => String(value || '').trim()).filter(Boolean) : []

    if (!storeId || orderIds.length === 0) {
      return NextResponse.json({ error: 'MISSING_REQUIRED_FIELDS' }, { status: 400 })
    }

    await verifyStoreAccess(supabase, user.id, storeId)

    const admin = createAdminClient()
    const { data: config, error: configError } = await admin
      .from('rapid_delivery_configs')
      .select('integration_id, default_shop_key')
      .eq('store_id', storeId)
      .maybeSingle()

    if (configError) throw configError
    if (!config?.integration_id) {
      return NextResponse.json({ error: 'RAPID_DELIVERY_NOT_CONFIGURED' }, { status: 400 })
    }

    const resolvedShopKey = await resolveDefaultRapidDeliveryShopKey({
      client: admin,
      integrationId: config.integration_id,
      storeId,
      fallbackShopKey: Number(config.default_shop_key || 0) || null,
    })

    if (!resolvedShopKey) {
      return NextResponse.json({ error: 'NO_RAPID_DELIVERY_SHOP_FOR_STORE' }, { status: 400 })
    }

    const { data: orders, error: ordersError } = await admin
      .from('orders')
      .select('id, status, rapid_delivery_parcel_key, rapid_delivery_voucher_key, store_id')
      .eq('store_id', storeId)
      .in('id', orderIds)

    if (ordersError) throw ordersError

    const validOrders = (orders || []).filter((order) =>
      order.status === 'confirmed' && order.rapid_delivery_parcel_key && !order.rapid_delivery_voucher_key
    )

    if (validOrders.length !== orderIds.length) {
      return NextResponse.json({ error: 'INVALID_ORDERS_FOR_VOUCHER' }, { status: 400 })
    }

    const token = await getDecryptedIntegrationToken(admin, config.integration_id)
    const parcelKeys = validOrders.map((order) => String(order.rapid_delivery_parcel_key))
    const created = await createRapidDeliveryVoucher(token, {
      shop: resolvedShopKey,
      parcels: parcelKeys,
    })

    const voucherKey = String(created?.data?.key || '').trim()
    if (!voucherKey) {
      return NextResponse.json({ error: 'INVALID_VOUCHER_KEY' }, { status: 502 })
    }

    const now = new Date().toISOString()
    const { error: updateOrdersError } = await admin
      .from('orders')
      .update({
        rapid_delivery_voucher_key: voucherKey,
        last_status_update_at: now,
        delivery_status: 'pickup_pending',
        updated_at: now,
      })
      .in('id', validOrders.map((order) => order.id))

    if (updateOrdersError) throw updateOrdersError

    const { error: mappingError } = await admin.from('rapid_delivery_entity_mappings').upsert(
      {
        user_id: user.id,
        integration_id: config.integration_id,
        store_id: storeId,
        entity_type: 'voucher',
        rapid_delivery_id: voucherKey,
        internal_id: validOrders[0].id,
        payload: { ...created, order_ids: validOrders.map((order) => order.id), parcels: parcelKeys },
        updated_at: now,
      },
      { onConflict: 'integration_id,entity_type,rapid_delivery_id' }
    )

    if (mappingError) throw mappingError
    return NextResponse.json({ ok: true, voucherKey, count: validOrders.length, message: created.message })
  } catch (error) {
    const message = toRapidDeliveryVoucherErrorMessage(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}