import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { createRapidDeliveryParcel, normalizeRapidDeliveryPhone } from '@/lib/integrations/rapid-delivery'
import { getDecryptedIntegrationToken } from '@/lib/integrations/rapid-delivery-connect'
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
    const [configResult, orderResult] = await Promise.all([
      admin
        .from('rapid_delivery_configs')
        .select('integration_id')
        .eq('store_id', storeId)
        .maybeSingle(),
      supabase.from('orders')
        .select('id, customer_name, phone, address, city, total_selling_price, order_items(quantity, products(name))')
        .eq('id', orderId)
        .eq('store_id', storeId)
        .maybeSingle(),
    ])

    const { data: config, error: configError } = configResult
    const { data: order, error: orderError } = orderResult

    if (configError) throw configError
    if (orderError) throw orderError
    if (!config?.integration_id) {
      return NextResponse.json({ error: 'RAPID_DELIVERY_NOT_CONNECTED' }, { status: 400 })
    }
    if (!order) return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })

    const token = await getDecryptedIntegrationToken(admin, config.integration_id)

    // Normaliser la ville : persiste le nom canonique + l'alias Rapid Delivery
    if (order.city) {
      await normalizeCityName({
        rawCity: order.city,
        orderId: order.id,
        supabase: admin,
        providerSlug: 'rapid-delivery',
      })
    }

    const article = (order.order_items || [])
      .map((item: any) => String(item?.products?.name || '').trim())
      .filter(Boolean)
      .join(', ') || 'Commande'

    const created = await createRapidDeliveryParcel(token, {
      article,
      price: Number(order.total_selling_price || 0),
      phone: normalizeRapidDeliveryPhone(order.phone || ''),
      city: cityKey,
      shop: shopKey,
      address: String(order.address || '').trim() || undefined,
      recipient: String(order.customer_name || '').trim() || undefined,
      remark: String(body.remark || '').trim() || undefined,
    })

    const trackingNumber = String(created?.data?.key || '')
    if (!trackingNumber) return NextResponse.json({ error: 'INVALID_TRACKING_NUMBER' }, { status: 502 })

    const now = new Date().toISOString()
    const { error: updateOrderError } = await supabase
      .from('orders')
      .update({
        tracking_number: trackingNumber,
        rapid_delivery_parcel_key: trackingNumber,
        delivery_city_external_id: cityKey,
        external_delivery_id: trackingNumber,
        delivery_status: 'pending',
        last_delivery_sync_at: now,
        updated_at: now,
      })
      .eq('id', orderId)

    if (updateOrderError) throw updateOrderError

    const { error: mappingError } = await supabase.from('rapid_delivery_entity_mappings').upsert(
      {
        user_id: user.id,
        integration_id: config.integration_id,
        store_id: storeId,
        entity_type: 'parcel',
        rapid_delivery_id: trackingNumber,
        internal_id: orderId,
        payload: created,
        updated_at: now,
      },
      { onConflict: 'integration_id,entity_type,rapid_delivery_id' }
    )

    if (mappingError) throw mappingError
    return NextResponse.json({ ok: true, trackingNumber, message: created.message })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RAPID_DELIVERY_CREATE_PARCEL_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}