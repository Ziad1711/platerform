import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { createDeliveryLogger } from '@/lib/integrations/delivery/logger'
import { rapidDeliveryAdapter } from '@/lib/integrations/delivery/rapid-delivery-adapter'
import { createParcelForOrder } from '@/lib/integrations/delivery/parcel-service'
import { createVoucherForParcels } from '@/lib/integrations/delivery/voucher-service'
import { getRapidDeliveryIntegrationCredentials, resolveDefaultRapidDeliveryShopKey } from '@/lib/integrations/rapid-delivery-connect'

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

    const { token, baseUrl } = await getRapidDeliveryIntegrationCredentials(admin, config.integration_id)

    const logger = createDeliveryLogger({
      admin,
      integrationId: config.integration_id,
      storeId,
      userId: user.id,
    })

    const deliveryConfig = {
      integrationId: config.integration_id,
      token,
      baseUrl,
      userId: user.id,
      storeId,
    }

    // Récupérer les commandes
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

    // Étape 1 : S'assurer que chaque commande a un colis valide
    const parcelKeys: Array<string | number> = []
    const orderIdsWithParcels: string[] = []

    for (const order of confirmedOrders) {
      const existingParcelKey = String(order.rapid_delivery_parcel_key || '').trim()

      // Vérifier si le colis existe déjà dans les mappings
      const { data: mapping } = existingParcelKey
        ? await admin
            .from('rapid_delivery_entity_mappings')
            .select('rapid_delivery_id')
            .eq('integration_id', config.integration_id)
            .eq('store_id', storeId)
            .eq('entity_type', 'parcel')
            .eq('rapid_delivery_id', existingParcelKey)
            .maybeSingle()
        : { data: null }

      if (mapping?.rapid_delivery_id) {
        // Colis valide existant
        const key = existingParcelKey
        parcelKeys.push(/^\d+$/.test(key) ? Number(key) : key)
        orderIdsWithParcels.push(order.id)
        continue
      }

      // Pas de colis valide → en créer un
      if (existingParcelKey) {
        logger.warn('voucher-invalid-parcel', 'Clé colis invalide, recréation', {
          orderId: order.id,
          oldParcelKey: existingParcelKey,
        })
        await admin
          .from('orders')
          .update({ rapid_delivery_parcel_key: null, updated_at: new Date().toISOString() })
          .eq('id', order.id)
      }

      const result = await createParcelForOrder({
        admin,
        provider: rapidDeliveryAdapter,
        config: deliveryConfig,
        order: {
          id: order.id,
          storeId: order.store_id,
          city: order.city,
          address: order.address,
          phone: order.phone,
          customerName: order.customer_name,
          totalSellingPrice: order.total_selling_price,
          trackingNumber: null,
          rapidDeliveryCityKey: order.rapid_delivery_city_key,
          orderItems: (order.order_items || []).map((oi: any) => ({
            productName: Array.isArray(oi.products) ? (oi.products[0]?.name ?? null) : oi.products?.name ?? null,
          })),
        },
        defaultShopKey: resolvedShopKey,
        defaultArticleName: 'Commande',
        logger,
      })

      if (!result.trackingNumber) {
        return NextResponse.json({ error: result.warning || 'RAPID_DELIVERY_PARCEL_NOT_CREATED' }, { status: 400 })
      }

      const key = result.trackingNumber
      parcelKeys.push(/^\d+$/.test(key) ? Number(key) : key)
      orderIdsWithParcels.push(order.id)
    }

    // Étape 2 : Créer le voucher
    const voucherResult = await createVoucherForParcels({
      admin,
      provider: rapidDeliveryAdapter,
      config: deliveryConfig,
      storeId,
      orderIds: orderIdsWithParcels,
      parcelKeys,
      shopKey: resolvedShopKey,
      logger,
    })

    return NextResponse.json({
      ok: true,
      voucherKey: voucherResult.voucherKey,
      count: orderIdsWithParcels.length,
      remoteVerified: voucherResult.remoteVerified,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RAPID_DELIVERY_CREATE_VOUCHER_FAILED'
    console.error('Rapid Delivery voucher create error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
