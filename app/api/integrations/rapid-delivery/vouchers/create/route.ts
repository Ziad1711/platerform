import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { createRapidDeliveryVoucher } from '@/lib/integrations/rapid-delivery'
import { autoCreateRapidDeliveryParcelForOrder } from '@/lib/integrations/rapid-delivery-auto'
import { normalizeOrderCityById } from '@/lib/integrations/city-normalizer'
import { getRapidDeliveryIntegrationCredentials, resolveDefaultRapidDeliveryShopKey } from '@/lib/integrations/rapid-delivery-connect'

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

async function isValidRapidDeliveryParcel(params: {
  admin: ReturnType<typeof createAdminClient>
  integrationId: string
  storeId: string
  parcelKey: string
}) {
  const { data, error } = await params.admin
    .from('rapid_delivery_entity_mappings')
    .select('rapid_delivery_id')
    .eq('integration_id', params.integrationId)
    .eq('store_id', params.storeId)
    .eq('entity_type', 'parcel')
    .eq('rapid_delivery_id', params.parcelKey)
    .maybeSingle()

  if (error) throw error
  return Boolean(data?.rapid_delivery_id)
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
      .select('id, status, rapid_delivery_parcel_key, rapid_delivery_voucher_key, store_id, city, address, phone, customer_name, total_selling_price, tracking_number, rapid_delivery_city_key, order_items(quantity, products(name))')
      .eq('store_id', storeId)
      .in('id', orderIds)

    if (ordersError) throw ordersError

    const confirmedOrders = (orders || []).filter((order) => order.status === 'confirmed' && !order.rapid_delivery_voucher_key)

    if (confirmedOrders.length !== orderIds.length) {
      return NextResponse.json({ error: 'INVALID_ORDERS_FOR_VOUCHER' }, { status: 400 })
    }

    const parcelReadyOrders = []
    for (const order of confirmedOrders) {
      const parcelKey = String(order.rapid_delivery_parcel_key || '').trim()
      const hasValidParcel = parcelKey
        ? await isValidRapidDeliveryParcel({
          admin,
          integrationId: config.integration_id,
          storeId,
          parcelKey,
        })
        : false

      if (!hasValidParcel) {
        if (parcelKey) {
          console.warn('Rapid Delivery voucher ignored invalid parcel key', {
            orderId: order.id,
            parcelKey,
            storeId,
            integrationId: config.integration_id,
          })
        }

        await admin
          .from('orders')
          .update({ rapid_delivery_parcel_key: null, updated_at: new Date().toISOString() })
          .eq('id', order.id)

        await normalizeOrderCityById(order.id, admin)
        const result = await autoCreateRapidDeliveryParcelForOrder({
          admin,
          userId: user.id,
          integrationId: config.integration_id,
          order: {
            ...order,
            tracking_number: null,
            rapid_delivery_parcel_key: null,
            order_items: (order.order_items || []).map((oi: any) => ({
              ...oi,
              products: Array.isArray(oi.products) ? (oi.products[0] ?? null) : oi.products,
            })),
          },
          defaultShopKey: resolvedShopKey,
          defaultArticleName: 'Commande',
        })

        if (!result.trackingNumber) {
          return NextResponse.json({ error: result.warning || 'RAPID_DELIVERY_PARCEL_NOT_CREATED' }, { status: 400 })
        }

        parcelReadyOrders.push({ ...order, rapid_delivery_parcel_key: result.trackingNumber })
      } else {
        parcelReadyOrders.push({ ...order, rapid_delivery_parcel_key: parcelKey })
      }
    }

    const { token, baseUrl } = await getRapidDeliveryIntegrationCredentials(admin, config.integration_id)
    const parcelKeys = parcelReadyOrders.map((order) => String(order.rapid_delivery_parcel_key))
    const created = await createRapidDeliveryVoucher(token, {
      shop: resolvedShopKey,
      parcels: parcelKeys,
    }, baseUrl)

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
      .in('id', parcelReadyOrders.map((order) => order.id))

    if (updateOrdersError) throw updateOrdersError

    const { error: mappingError } = await admin.from('rapid_delivery_entity_mappings').upsert(
      {
        user_id: user.id,
        integration_id: config.integration_id,
        store_id: storeId,
        entity_type: 'voucher',
        rapid_delivery_id: voucherKey,
        internal_id: parcelReadyOrders[0].id,
        payload: { ...created, order_ids: parcelReadyOrders.map((order) => order.id), parcels: parcelKeys },
        updated_at: now,
      },
      { onConflict: 'integration_id,entity_type,rapid_delivery_id' }
    )

    if (mappingError) throw mappingError
    return NextResponse.json({ ok: true, voucherKey, count: parcelReadyOrders.length, message: created.message })
  } catch (error) {
    const message = toRapidDeliveryVoucherErrorMessage(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}