import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { ozoneAdapter } from '@/lib/integrations/delivery/ozone-adapter'
import { createVoucherForParcels } from '@/lib/integrations/delivery/voucher-service'
import { createDeliveryLogger } from '@/lib/integrations/delivery/logger'

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

    // Récupérer l'intégration OZONE
    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('provider', 'ozone')
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration || integration.status !== 'connected') {
      return NextResponse.json({ error: 'OZONE_NOT_CONFIGURED' }, { status: 400 })
    }

    // Récupérer les commandes confirmées avec colis OZONE
    const { data: orders, error: ordersError } = await admin
      .from('orders')
      .select('id, status, tracking_number, delivery_parcel_key, rapid_delivery_parcel_key, delivery_voucher_key, rapid_delivery_voucher_key, store_id')
      .eq('store_id', storeId)
      .in('id', orderIds)

    if (ordersError) throw ordersError

    const parcelKeyField = 'tracking_number'
    const validOrders = (orders || []).filter((order) =>
      order.status === 'confirmed' && String(order[parcelKeyField] || '').trim() && !order.delivery_voucher_key && !order.rapid_delivery_voucher_key
    )

    if (validOrders.length !== orderIds.length) {
      return NextResponse.json({ error: 'INVALID_ORDERS_FOR_VOUCHER' }, { status: 400 })
    }

    // Décrypter le token
    const { getDecryptedIntegrationToken } = await import('@/lib/integrations/rapid-delivery-connect')
    const token = await getDecryptedIntegrationToken(admin, integration.id)

    const parcelKeys = validOrders.map((order) => String(order[parcelKeyField] || '').trim()).filter(Boolean)

    const logger = createDeliveryLogger({
      admin,
      integrationId: integration.id,
      storeId,
      userId: user.id,
    })

    const result = await createVoucherForParcels({
      admin,
      provider: ozoneAdapter,
      config: {
        integrationId: integration.id,
        token,
        baseUrl: null,
        userId: user.id,
        storeId,
      },
      storeId,
      orderIds: validOrders.map((o) => o.id),
      parcelKeys,
      shopKey: 0, // OZONE n'utilise pas de shop key pour les BL
      logger,
    })

    return NextResponse.json({
      ok: true,
      voucherKey: result.voucherKey,
      count: result.totalParcels,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OZONE_CREATE_VOUCHER_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
