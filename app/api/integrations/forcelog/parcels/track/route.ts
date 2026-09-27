import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser } from '@/lib/assistant/security'
import { trackForceLogParcel, mapForceLogStatusToOrderStatus } from '@/lib/integrations/forcelog'
import { getDecryptedIntegrationToken } from '@/lib/integrations/rapid-delivery-connect'

export async function GET(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { user } = await requireAuthenticatedUser()

    const url = new URL(request.url)
    const trackingNumber = url.searchParams.get('code') || ''
    const integrationId = url.searchParams.get('integrationId') || ''

    if (!trackingNumber) return NextResponse.json({ error: 'MISSING_TRACKING_CODE' }, { status: 400 })
    if (!integrationId) return NextResponse.json({ error: 'MISSING_INTEGRATION_ID' }, { status: 400 })

    const admin = createAdminClient()

    const { data: integration } = await admin
      .from('integrations')
      .select('store_id')
      .eq('id', integrationId)
      .maybeSingle()
    if (!integration?.store_id) return NextResponse.json({ error: 'INTEGRATION_NOT_FOUND' }, { status: 404 })

    const { data: membership, error: membershipError } = await admin
      .from('store_members')
      .select('store_id')
      .eq('user_id', user.id)
      .eq('store_id', integration.store_id)
      .eq('status', 'active')
      .maybeSingle()

    if (membershipError) throw membershipError
    if (!membership) return NextResponse.json({ error: 'STORE_ACCESS_DENIED' }, { status: 403 })

    const apiKey = await getDecryptedIntegrationToken(admin, integrationId)
    const raw = await trackForceLogParcel(apiKey, trackingNumber)

    const rawStatus = String((raw as any)?.PARCEL?.STATUS || '').trim()
    const mapped = mapForceLogStatusToOrderStatus(rawStatus)

    return NextResponse.json({
      ok: true,
      trackingNumber,
      rawStatus: mapped.rawStatus,
      orderStatus: mapped.orderStatus,
      deliveryStatus: mapped.deliveryStatus,
      statusDateField: mapped.statusDateField,
      raw,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FORCELOG_TRACK_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}