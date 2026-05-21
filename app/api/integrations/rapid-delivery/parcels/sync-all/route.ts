import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import { createDeliveryLogger } from '@/lib/integrations/delivery/logger'
import { rapidDeliveryAdapter } from '@/lib/integrations/delivery/rapid-delivery-adapter'
import { syncAllNonFinalOrders } from '@/lib/integrations/delivery/tracking-service'
import { getRapidDeliveryIntegrationCredentials } from '@/lib/integrations/rapid-delivery-connect'

export async function POST() {
  try {
    const { user } = await requireAuthenticatedUser()
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

    const result = await syncAllNonFinalOrders({
      admin,
      provider: rapidDeliveryAdapter,
      config,
      logger,
    })

    return NextResponse.json({ synced: result.synced, errors: result.errors })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RAPID_DELIVERY_SYNC_ALL_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
