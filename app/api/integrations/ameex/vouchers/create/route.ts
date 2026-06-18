import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { getAmeexCredentials } from '@/lib/integrations/ameex-credentials'
import { getProvider } from '@/lib/integrations/delivery/provider'
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

    // Récupérer l'intégration AMEEX
    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id, provider_id, status')
      .eq('user_id', user.id)
      .eq('provider', 'ameex')
      .eq('store_id', storeId)
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration || integration.status !== 'connected') {
      return NextResponse.json({ error: 'AMEEX_NOT_CONNECTED' }, { status: 400 })
    }

    // Récupérer les commandes avec leurs codes colis AMEEX
    const { data: orders, error: ordersError } = await admin
      .from('orders')
      .select('id, status, ameex_parcel_code, ameex_delivery_note_ref, store_id')
      .eq('store_id', storeId)
      .in('id', orderIds)

    if (ordersError) throw ordersError

    const validOrders = (orders || []).filter((order) =>
      ['confirmed', 'dl_pickup_pending'].includes(order.status)
      && order.ameex_parcel_code
      && !order.ameex_delivery_note_ref
    )

    if (validOrders.length !== orderIds.length) {
      return NextResponse.json({ error: 'INVALID_ORDERS_FOR_VOUCHER' }, { status: 400 })
    }

    // Récupérer les credentials
    const credentials = await getAmeexCredentials(admin, integration.id)

    // Récupérer le shop (business_id) depuis la config
    const { data: config } = await admin
      .from('ameex_configs')
      .select('business_id')
      .eq('store_id', storeId)
      .maybeSingle()

    const businessId = config?.business_id || credentials.apiId

    // Récupérer le provider
    const provider = getProvider('ameex')
    if (!provider) {
      return NextResponse.json({ error: 'AMEEX_PROVIDER_NOT_FOUND' }, { status: 500 })
    }

    const logger = createDeliveryLogger({ admin, integrationId: integration.id, storeId, userId: user.id })

    // Utiliser le service générique de voucher
    const result = await createVoucherForParcels({
      admin,
      provider,
      config: {
      integrationId: integration.id,
      providerId: integration.provider_id,
      token: credentials.apiId,
      apiKey: credentials.apiKey,
      baseUrl: null,
      userId: user.id,
      storeId,
      },
      storeId,
      orderIds: validOrders.map((o) => o.id),
      parcelKeys: validOrders.map((o) => String(o.ameex_parcel_code)),
      shopKey: Number(businessId) || 0,
      logger,
    })

    return NextResponse.json({
      ok: true,
      voucherKey: result.voucherKey,
      totalParcels: result.totalParcels,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AMEEX_VOUCHER_CREATE_FAILED'
    // Logger la reponse brute si disponible dans l'erreur
    const rawMatch = message.match(/Reponse: (.+)$/)
    const rawResponse = rawMatch ? rawMatch[1] : null
    if (rawResponse) {
      console.error('[AMEEX_VOUCHER_RAW_RESPONSE]', rawResponse)
    }
    return NextResponse.json({ error: message, rawResponse }, { status: 500 })
  }
}
