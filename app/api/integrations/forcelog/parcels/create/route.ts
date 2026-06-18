import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { createForceLogParcel, normalizeForceLogPhone } from '@/lib/integrations/forcelog'
import { getDecryptedIntegrationToken } from '@/lib/integrations/rapid-delivery-connect'
import { normalizeOrderCityById } from '@/lib/integrations/city-normalizer'
import { resolveDeliveryFee } from '@/lib/integrations/delivery/delivery-fee-resolver'

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      orderId?: string
      cityKey?: string
      cityName?: string
      productNature?: string
      canOpen?: boolean
      fragile?: boolean
      carton?: string
      stock?: string
      deliveryNote?: string
    }
    const orderId = String(body.orderId || '').trim()
    if (!orderId) return NextResponse.json({ error: 'MISSING_ORDER_ID' }, { status: 400 })

    const admin = createAdminClient()

    const { data: order, error: orderError } = await admin
      .from('orders')
      .select(`
        id, store_id, status, city, address, phone, customer_name, total_selling_price,
        delivery_city_external_id, delivery_company_id, tracking_number, forcelog_parcel_key,
        order_items(quantity, products(name))
      `)
      .eq('id', orderId)
      .maybeSingle()

    if (orderError) throw orderError
    if (!order) return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    await verifyStoreAccess(supabase, user.id, order.store_id)

    if (order.forcelog_parcel_key || order.tracking_number) {
      return NextResponse.json({ error: 'PARCEL_ALREADY_EXISTS', trackingNumber: order.forcelog_parcel_key || order.tracking_number }, { status: 409 })
    }

    // Récupérer l'intégration ForceLog
    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('provider', 'forcelog')
      .eq('store_id', order.store_id)
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration || integration.status !== 'connected') {
      return NextResponse.json({ error: 'FORCELOG_NOT_CONNECTED' }, { status: 400 })
    }

    // Récupérer la config ForceLog
    const { data: config } = await admin
      .from('forcelog_configs')
      .select('*')
      .eq('store_id', order.store_id)
      .maybeSingle()

    // Normaliser la ville - ForceLog accepte le nom de la ville directement
    let cityValue = body.cityKey || String(order.delivery_city_external_id || '').trim()
    let cityName = body.cityName || String(order.city || '').trim() || ''

    if (!cityValue) {
      const cityMatch = await normalizeOrderCityById(order.id, admin, 'forcelog')
      cityValue = cityMatch.cityKey || ''
      if (!cityValue && cityMatch.cityName) {
        cityName = cityMatch.cityName
      }
    }

    // Si pas de clé, utiliser le nom de ville normalisé ou le raw
    const forceLogCity = cityValue || cityName || 'Ville non spécifiée'

    // Résoudre les frais de livraison (fallback à 0 si pas de clé)
    const deliveryFee = cityValue ? await resolveDeliveryFee({
      supabase: admin,
      storeId: order.store_id,
      cityKey: Number(cityValue) || 0,
      integrationId: integration.id,
      providerSlug: 'forcelog',
    }) : 0

    // Décrypter le token
    const apiKey = await getDecryptedIntegrationToken(admin, integration.id)

    // Préparer le payload
    const orderProductNames = (order.order_items || [])
      .map((item: any) => String(item?.products?.name || '').trim())
      .filter(Boolean)
      .join(', ')

    const productNature = body.productNature || config?.default_product_nature || orderProductNames || 'Commande'

    const result = await createForceLogParcel(apiKey, {
      ORDER_NUM: String(order.id).slice(-20),
      RECEIVER: String(order.customer_name || 'Client').slice(0, 50),
      PHONE: normalizeForceLogPhone(order.phone || '').slice(0, 14),
      CITY: String(forceLogCity).slice(0, 50),
      ADDRESS: String(order.address || 'Adresse non spécifiée').slice(0, 100),
      COMMENT: body.deliveryNote ? String(body.deliveryNote).slice(0, 100) : undefined,
      PRODUCT_NATURE: productNature.slice(0, 100),
      COD: Number(order.total_selling_price || 0),
      CAN_OPEN: body.canOpen !== undefined ? body.canOpen : (config?.default_can_open ?? true),
      FRAGILE: body.fragile !== undefined ? body.fragile : (config?.default_fragile ?? false),
      CARTON: body.carton || config?.default_carton || undefined,
      STOCK: body.stock || config?.default_stock || undefined,
    })

    if (result?.['ADD-PARCEL']?.RESULT === 'ERROR') {
      throw new Error(`FORCELOG_PARCEL_CREATE_FAILED:${result['ADD-PARCEL']?.MESSAGE || 'Unknown error'}`)
    }

    const trackingNumber = String(result?.['ADD-PARCEL']?.['NEW-PARCEL']?.TRACKING_NUMBER || '').trim()
    if (!trackingNumber) throw new Error('FORCELOG_NO_TRACKING_NUMBER')

    const now = new Date().toISOString()

    await admin.from('orders').update({
      tracking_number: trackingNumber,
      external_delivery_id: trackingNumber,
      forcelog_parcel_key: trackingNumber,
      forcelog_city_key: forceLogCity,
      delivery_city_external_id: cityValue || null,
      delivery_fee: deliveryFee || 0,
      delivery_status: 'pending',
      delivery_status_source: 'delivery_company',
      last_delivery_sync_at: now,
      updated_at: now,
    }).eq('id', orderId)

    return NextResponse.json({ ok: true, trackingNumber, deliveryFee })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FORCELOG_PARCEL_CREATE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}