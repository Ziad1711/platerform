import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser } from '@/lib/assistant/security'
import { trackSenditParcel, mapSenditStatusToOrderStatus } from '@/lib/integrations/sendit'
import { getSenditCredentials } from '@/lib/integrations/sendit-credentials'

export async function GET(request: Request) {
  try {
    assertTrustedOrigin(request)
    await requireAuthenticatedUser()

    const url = new URL(request.url)
    const trackingNumber = url.searchParams.get('code') || ''
    const integrationId = url.searchParams.get('integrationId') || ''

    if (!trackingNumber) return NextResponse.json({ error: 'MISSING_TRACKING_CODE' }, { status: 400 })
    if (!integrationId) return NextResponse.json({ error: 'MISSING_INTEGRATION_ID' }, { status: 400 })

    const admin = createAdminClient()
    const credentials = await getSenditCredentials(admin, integrationId)
    const raw = await trackSenditParcel(credentials.token, trackingNumber)

    const rawStatus = String((raw as any)?.data?.status || '').trim()
    const mapped = mapSenditStatusToOrderStatus(rawStatus)

    return NextResponse.json({
      ok: true,
      trackingNumber,
      rawStatus,
      orderStatus: mapped.orderStatus,
      deliveryStatus: mapped.deliveryStatus,
      statusDateField: mapped.statusDateField,
      raw,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SENDIT_TRACK_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
