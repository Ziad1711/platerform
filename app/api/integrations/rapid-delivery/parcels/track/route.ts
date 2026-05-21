import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import { createDeliveryLogger } from '@/lib/integrations/delivery/logger'
import { rapidDeliveryAdapter } from '@/lib/integrations/delivery/rapid-delivery-adapter'
import { trackAndUpdateOrder } from '@/lib/integrations/delivery/tracking-service'
import { getRapidDeliveryIntegrationCredentials } from '@/lib/integrations/rapid-delivery-connect'

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const { searchParams } = new URL(request.url)
    const orderId = String(searchParams.get('orderId') || '').trim()
    const trackingNumber = String(searchParams.get('trackingNumber') || '').trim()

    if (!trackingNumber) return NextResponse.json({ error: 'MISSING_TRACKING_NUMBER' }, { status: 400 })

    const admin = createAdminClient()
    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('provider', 'rapid-delivery')
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration || integration.status !== 'connected') {
      return NextResponse.json({ error: 'RAPID_DELIVERY_NOT_CONNECTED' }, { status: 400 })
    }

    const { token, baseUrl } = await getRapidDeliveryIntegrationCredentials(admin, integration.id)

    const logger = createDeliveryLogger({
      admin,
      integrationId: integration.id,
      storeId: '',
      userId: user.id,
    })

    const config = {
      integrationId: integration.id,
      token,
      baseUrl,
      userId: user.id,
      storeId: '',
    }

    const result = await trackAndUpdateOrder({
      admin,
      provider: rapidDeliveryAdapter,
      config,
      trackingNumber,
      orderId: orderId || undefined,
      logger,
    })

    return NextResponse.json({ ok: true, tracking: result.raw, mapped: { rawStatus: result.rawStatus, orderStatus: result.orderStatus, deliveryStatus: result.deliveryStatus } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RAPID_DELIVERY_TRACK_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
