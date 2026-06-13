import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { ozoneAdapter } from '@/lib/integrations/delivery/ozone-adapter'
import { createParcelForOrder } from '@/lib/integrations/delivery/parcel-service'
import { createDeliveryLogger } from '@/lib/integrations/delivery/logger'
import { normalizeCityName } from '@/lib/integrations/city-normalizer'

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
    const cityKey = Number(body.cityKey || 0)
    const shopKey = Number(body.shopKey || 0)

    if (!storeId || !orderId || !cityKey || !shopKey) {
      return NextResponse.json({ error: 'MISSING_REQUIRED_FIELDS' }, { status: 400 })
    }

    await verifyStoreAccess(supabase, user.id, storeId)

    const admin = createAdminClient()

    // Récupérer l'intégration OZONE
    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id, status, token_encrypted')
      .eq('user_id', user.id)
      .eq('provider', 'ozone')
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration || integration.status !== 'connected') {
      return NextResponse.json({ error: 'OZONE_NOT_CONNECTED' }, { status: 400 })
    }

    // Récupérer la commande
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, customer_name, phone, address, city, total_selling_price, store_id, tracking_number, delivery_city_external_id, order_items(quantity, products(name))')
      .eq('id', orderId)
      .eq('store_id', storeId)
      .maybeSingle()

    if (orderError) throw orderError
    if (!order) return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })

    // Décrypter le token
    const { getDecryptedIntegrationToken } = await import('@/lib/integrations/rapid-delivery-connect')
    const token = await getDecryptedIntegrationToken(admin, integration.id)

    // Normaliser la ville : persiste le nom canonique + l'alias Ozone
    if (order.city) {
      await normalizeCityName({
        rawCity: order.city,
        orderId: order.id,
        supabase: admin,
        providerSlug: 'ozone',
      })
    }

    const logger = createDeliveryLogger({
      admin,
      integrationId: integration.id,
      storeId,
      userId: user.id,
    })

    const result = await createParcelForOrder({
      admin,
      provider: ozoneAdapter,
      config: {
        integrationId: integration.id,
        token,
        baseUrl: null,
        userId: user.id,
        storeId,
      },
      order: {
        id: order.id,
        storeId: order.store_id,
        city: order.city,
        address: order.address,
        phone: order.phone,
        customerName: order.customer_name,
        totalSellingPrice: order.total_selling_price,
        trackingNumber: order.tracking_number,
        deliveryCityKey: cityKey,
        orderItems: (order.order_items || []).map((oi: any) => ({
          productName: oi.products?.name || null,
        })),
      },
      defaultShopKey: shopKey,
      defaultArticleName: body.remark || undefined,
      logger,
    })

    if (result.warning) {
      return NextResponse.json({ ok: false, warning: result.warning, trackingNumber: result.trackingNumber })
    }

    return NextResponse.json({ ok: true, trackingNumber: result.trackingNumber })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OZONE_CREATE_PARCEL_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
