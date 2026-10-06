import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { createRushlivParcel, normalizeRushlivPhone } from '@/lib/integrations/rushliv'
import { getDecryptedIntegrationToken } from '@/lib/integrations/rushliv-connect'
import { normalizeCityName } from '@/lib/integrations/city-normalizer'
import { buildOrderArticleLabel } from '@/lib/integrations/delivery/order-article'

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      storeId?: string
      orderId?: string
      cityKey?: string | number
      remark?: string
    }

    const storeId = String(body.storeId || '').trim()
    const orderId = String(body.orderId || '').trim()
    const requestedCityKey = String(body.cityKey ?? '').trim()

    if (!storeId || !orderId) {
      return NextResponse.json({ error: 'MISSING_REQUIRED_FIELDS' }, { status: 400 })
    }

    await verifyStoreAccess(supabase, user.id, storeId)

    const admin = createAdminClient()
    const [configResult, orderResult] = await Promise.all([
      admin
        .from('rushliv_configs')
        .select('integration_id, default_article_name')
        .eq('store_id', storeId)
        .maybeSingle(),
      supabase.from('orders')
        .select('id, tracking_number, external_delivery_id, rushliv_parcel_key, customer_name, phone, address, city, total_selling_price, order_items(quantity, product_name_override, products(name), product_variants(name))')
        .eq('id', orderId)
        .eq('store_id', storeId)
        .maybeSingle(),
    ])

    const { data: config, error: configError } = configResult
    const { data: order, error: orderError } = orderResult

    if (configError) throw configError
    if (orderError) throw orderError
    if (!config?.integration_id) {
      return NextResponse.json({ error: 'RUSHLIV_NOT_CONNECTED' }, { status: 400 })
    }
    if (!order) return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })

    // Un colis déjà créé ne doit jamais être dupliqué chez Rushliv : on renvoie
    // le numéro de suivi existant pour que l'appelant poursuive le suivi.
    const existingTrackingNumber = String(
      order.rushliv_parcel_key || order.tracking_number || order.external_delivery_id || ''
    ).trim()

    if (existingTrackingNumber) {
      return NextResponse.json(
        { error: 'ORDER_ALREADY_HAS_PARCEL', trackingNumber: existingTrackingNumber },
        { status: 409 }
      )
    }

    const token = await getDecryptedIntegrationToken(admin, config.integration_id)

    // Rushliv attend un nom de ville (ou son code) : on résout d'abord la ville
    // canonique du référentiel synchronisé, avec repli sur la ville de commande.
    const normalized = order.city
      ? await normalizeCityName({
        rawCity: order.city,
        orderId: order.id,
        supabase: admin,
        providerSlug: 'rushliv',
      })
      : null

    const cityName = String(normalized?.cityName || order.city || '').trim()
    if (!cityName) return NextResponse.json({ error: 'MISSING_DELIVERY_CITY' }, { status: 400 })

    const cityKey = requestedCityKey || String(normalized?.cityKey || '').trim()
    const article = buildOrderArticleLabel(order.order_items) || config.default_article_name || 'Colis e-commerce'

    const created = await createRushlivParcel(token, {
      name: String(order.customer_name || '').trim() || 'Client',
      phone: normalizeRushlivPhone(order.phone || ''),
      product: article,
      ville: cityName,
      villeType: 'name',
      adresse: String(order.address || '').trim() || undefined,
      note: String(body.remark || '').trim() || undefined,
      price: Number(order.total_selling_price || 0),
    })

    const trackingNumber = String(created?.tracking || '').trim()
    if (!trackingNumber) return NextResponse.json({ error: 'INVALID_TRACKING_NUMBER' }, { status: 502 })

    const now = new Date().toISOString()
    const { error: updateOrderError } = await supabase
      .from('orders')
      .update({
        tracking_number: trackingNumber,
        rushliv_parcel_key: trackingNumber,
        rushliv_voucher_key: trackingNumber,
        delivery_city_external_id: cityKey || null,
        external_delivery_id: trackingNumber,
        delivery_status: 'pending',
        last_delivery_sync_at: now,
        updated_at: now,
      })
      .eq('id', orderId)

    if (updateOrderError) throw updateOrderError

    const { error: mappingError } = await admin.from('delivery_entity_mappings').upsert(
      {
        user_id: user.id,
        integration_id: config.integration_id,
        store_id: storeId,
        entity_type: 'parcel',
        provider_entity_id: trackingNumber,
        internal_id: orderId,
        payload: { provider_slug: 'rushliv', raw: created },
        updated_at: now,
      },
      { onConflict: 'integration_id,entity_type,provider_entity_id' }
    )

    if (mappingError) throw mappingError
    return NextResponse.json({ ok: true, trackingNumber, message: created.msg })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RUSHLIV_CREATE_PARCEL_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
