import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { createDeliveryLogger } from '@/lib/integrations/delivery/logger'
import { rapidDeliveryAdapter } from '@/lib/integrations/delivery/rapid-delivery-adapter'
import { createParcelForOrder } from '@/lib/integrations/delivery/parcel-service'
import { getRapidDeliveryIntegrationCredentials, resolveDefaultRapidDeliveryShopKey } from '@/lib/integrations/rapid-delivery-connect'

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      storeId?: string
      orderId?: string
      cityKey?: number
      shopKey?: number
      remark?: string
    }

    const storeId = String(body.storeId || '').trim()
    const orderId = String(body.orderId || '').trim()

    if (!storeId || !orderId) {
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
      return NextResponse.json({ error: 'RAPID_DELIVERY_NOT_CONNECTED' }, { status: 400 })
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, store_id, customer_name, phone, address, city, total_selling_price, tracking_number, rapid_delivery_city_key, rapid_delivery_parcel_key, order_items(quantity, products(name))')
      .eq('id', orderId)
      .eq('store_id', storeId)
      .maybeSingle()

    if (orderError) throw orderError
    if (!order) return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })

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

    const resolvedShopKey = await resolveDefaultRapidDeliveryShopKey({
      client: admin,
      integrationId: config.integration_id,
      storeId,
      fallbackShopKey: Number(config.default_shop_key || 0) || null,
    })

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
        trackingNumber: order.tracking_number,
        rapidDeliveryCityKey: order.rapid_delivery_city_key,
        rapidDeliveryParcelKey: order.rapid_delivery_parcel_key,
        orderItems: (order.order_items || []).map((item: any) => ({
          productName: item?.products?.name || null,
        })),
      },
      defaultShopKey: resolvedShopKey,
      defaultArticleName: 'Commande',
      logger,
    })

    if (!result.trackingNumber) {
      return NextResponse.json({ error: result.warning || 'RAPID_DELIVERY_PARCEL_NOT_CREATED' }, { status: 400 })
    }

    return NextResponse.json({ ok: true, trackingNumber: result.trackingNumber })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RAPID_DELIVERY_CREATE_PARCEL_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
