import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import { getDecryptedIntegrationToken } from '@/lib/integrations/rapid-delivery-connect'
import { createDeliveryLogger } from '@/lib/integrations/delivery/logger'
import { trackAndUpdateOrder } from '@/lib/integrations/delivery/tracking-service'
import { ozoneAdapter } from '@/lib/integrations/delivery/ozone-adapter'

export async function GET(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser()
    const { searchParams } = new URL(request.url)
    const orderId = String(searchParams.get('orderId') || '').trim()
    const trackingNumber = String(searchParams.get('trackingNumber') || '').trim()
    const storeId = String(searchParams.get('storeId') || '').trim()
    let resolvedStoreId = storeId

    if (!trackingNumber) return NextResponse.json({ error: 'MISSING_TRACKING_NUMBER' }, { status: 400 })

    const admin = createAdminClient()
    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('provider', 'ozone')
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration || integration.status !== 'connected') {
      return NextResponse.json({ error: 'OZONE_NOT_CONNECTED' }, { status: 400 })
    }

    if (orderId) {
      const { data: order, error: orderError } = await admin
        .from('orders')
        .select('id, store_id')
        .eq('id', orderId)
        .single()
      if (orderError) throw orderError
      resolvedStoreId = String(order.store_id || '')

      const { data: membership, error: membershipError } = await admin
        .from('store_members')
        .select('store_id')
        .eq('user_id', user.id)
        .eq('store_id', resolvedStoreId)
        .maybeSingle()
      if (membershipError) throw membershipError
      if (!membership) return NextResponse.json({ error: 'STORE_ACCESS_DENIED' }, { status: 403 })
    } else if (resolvedStoreId) {
      const { data: membership, error: membershipError } = await admin
        .from('store_members')
        .select('store_id')
        .eq('user_id', user.id)
        .eq('store_id', resolvedStoreId)
        .maybeSingle()
      if (membershipError) throw membershipError
      if (!membership) return NextResponse.json({ error: 'STORE_ACCESS_DENIED' }, { status: 403 })
    }

    const token = await getDecryptedIntegrationToken(admin, integration.id)
    const logger = createDeliveryLogger({ admin, integrationId: integration.id, storeId: resolvedStoreId, userId: user.id })
    const result = await trackAndUpdateOrder({
      admin,
      provider: ozoneAdapter,
      config: { integrationId: integration.id, token, baseUrl: null, userId: user.id, storeId: resolvedStoreId },
      trackingNumber,
      orderId: orderId || undefined,
      logger,
    })

    return NextResponse.json({ ok: true, tracking: result.raw, mapped: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OZONE_TRACK_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}