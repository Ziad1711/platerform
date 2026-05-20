import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { createRapidDeliveryVoucher, getRapidDeliveryVoucher, tryTrackRapidDeliveryParcel } from '@/lib/integrations/rapid-delivery'

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

function getRemoteParcelShopKey(parcel: unknown) {
  if (!parcel || typeof parcel !== 'object') return 0
  const record = parcel as Record<string, any>
  const data = record.data as Record<string, any> | undefined
  return Number(
    record.shop?.key || record.shop?.id ||
    record.shop_id ||
    data?.shop?.key || data?.shop?.id ||
    data?.shop_id ||
    0
  ) || 0
}

function getRapidDeliveryVoucherTotalParcels(voucher: unknown) {
  if (!voucher || typeof voucher !== 'object') return 0
  const record = voucher as Record<string, any>
  return Number(record.total_parcels || record.parcels_count || record.data?.total_parcels || record.data?.parcels_count || 0) || 0
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
    const finalParcelReadyOrders = []

    for (const order of parcelReadyOrders) {
      const parcelKey = String(order.rapid_delivery_parcel_key || '').trim()
      const remoteParcel = parcelKey ? await tryTrackRapidDeliveryParcel(token, parcelKey, baseUrl) : null
      const remoteShopKey = getRemoteParcelShopKey(remoteParcel)

      if (!remoteParcel || remoteShopKey !== resolvedShopKey) {
        console.warn('Rapid Delivery voucher recreating parcel before voucher', {
          orderId: order.id,
          oldParcelKey: parcelKey,
          remoteShopKey,
          expectedShopKey: resolvedShopKey,
          reason: !remoteParcel ? 'REMOTE_PARCEL_NOT_FOUND' : 'REMOTE_SHOP_MISMATCH',
        })

        await admin
          .from('orders')
          .update({ tracking_number: null, rapid_delivery_parcel_key: null, external_delivery_id: null, updated_at: new Date().toISOString() })
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

        finalParcelReadyOrders.push({ ...order, rapid_delivery_parcel_key: result.trackingNumber })
      } else {
        finalParcelReadyOrders.push(order)
      }
    }

    const finalParcelKeys = finalParcelReadyOrders.map((order) => String(order.rapid_delivery_parcel_key))
    const created = await createRapidDeliveryVoucher(token, {
      shop: resolvedShopKey,
      parcels: finalParcelKeys.map((value) => Number(value) || value),
    }, baseUrl)

    const voucherKey = String(created?.data?.key || '').trim()
    if (!voucherKey) {
      return NextResponse.json({ error: 'INVALID_VOUCHER_KEY' }, { status: 502 })
    }

    // Vérifier le total_parcels directement depuis la réponse POST
    let remoteVoucher: unknown = null
    const postTotalParcels = getRapidDeliveryVoucherTotalParcels(created)
    if (postTotalParcels > 0) {
      // Le POST a déjà confirmé les parcels, pas besoin de vérifier via GET
      console.log('Rapid Delivery voucher created with parcels confirmed by POST', {
        voucherKey,
        totalParcels: postTotalParcels,
      })
    } else {
      // Réessayer GET /vouchers/{key} jusqu'à 3 fois avec délai
      let remoteTotalParcels = 0
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
        }
        remoteVoucher = await getRapidDeliveryVoucher(token, voucherKey, baseUrl)
        remoteTotalParcels = getRapidDeliveryVoucherTotalParcels(remoteVoucher)
        if (remoteTotalParcels > 0) break
      }

      if (remoteTotalParcels <= 0) {
        console.error('Rapid Delivery voucher created empty remotely', {
          voucherKey,
          shop: resolvedShopKey,
          parcels: finalParcelKeys,
          created,
        })
        return NextResponse.json({ error: 'RAPID_DELIVERY_VOUCHER_CREATED_EMPTY_REMOTE' }, { status: 502 })
      }
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
      .in('id', finalParcelReadyOrders.map((order) => order.id))

    if (updateOrdersError) throw updateOrdersError

    const { error: mappingError } = await admin.from('rapid_delivery_entity_mappings').upsert(
      {
        user_id: user.id,
        integration_id: config.integration_id,
        store_id: storeId,
        entity_type: 'voucher',
        rapid_delivery_id: voucherKey,
        internal_id: finalParcelReadyOrders[0].id,
        payload: { ...created, remote_voucher: remoteVoucher, order_ids: finalParcelReadyOrders.map((order) => order.id), parcels: finalParcelKeys },
        updated_at: now,
      },
      { onConflict: 'integration_id,entity_type,rapid_delivery_id' }
    )

    if (mappingError) throw mappingError
    return NextResponse.json({ ok: true, voucherKey, count: finalParcelReadyOrders.length, message: created.message })
  } catch (error) {
    const message = toRapidDeliveryVoucherErrorMessage(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}