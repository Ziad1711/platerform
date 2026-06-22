import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { createSenditParcelForOrder } from '@/lib/integrations/delivery/sendit-adapter'

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      orderId?: string
      districtId?: string
      districtName?: string
      allowOpen?: boolean
      allowTry?: boolean
      productsFromStock?: boolean
      packagingId?: string
      optionExchange?: boolean
      deliveryExchangeId?: string
      deliveryNote?: string
    }
    const orderId = String(body.orderId || '').trim()
    if (!orderId) return NextResponse.json({ error: 'MISSING_ORDER_ID' }, { status: 400 })

    const admin = createAdminClient()

    const { data: order, error: orderError } = await admin
      .from('orders')
      .select('id, store_id')
      .eq('id', orderId)
      .maybeSingle()

    if (orderError) throw orderError
    if (!order) return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    await verifyStoreAccess(supabase, user.id, order.store_id)

    // Récupérer l'intégration Sendit
    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('provider', 'sendit')
      .eq('store_id', order.store_id)
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration || integration.status !== 'connected') {
      return NextResponse.json({ error: 'SENDIT_NOT_CONNECTED' }, { status: 400 })
    }

    const result = await createSenditParcelForOrder({
      admin,
      orderId,
      storeId: order.store_id,
      userId: user.id,
      integrationId: integration.id,
      deliveryNote: body.deliveryNote,
      districtId: body.districtId,
      districtName: body.districtName,
      allowOpen: body.allowOpen,
      allowTry: body.allowTry,
      productsFromStock: body.productsFromStock,
      packagingId: body.packagingId,
      optionExchange: body.optionExchange,
      deliveryExchangeId: body.deliveryExchangeId,
    })

    if (result.warning) {
      return NextResponse.json({ ok: false, warning: result.warning, trackingNumber: result.trackingNumber }, { status: 200 })
    }

    return NextResponse.json({ ok: true, trackingNumber: result.trackingNumber })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SENDIT_PARCEL_CREATE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
