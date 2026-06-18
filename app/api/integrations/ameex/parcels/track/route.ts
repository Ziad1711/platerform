import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser } from '@/lib/assistant/security'
import { trackAmeexParcel, mapAmeexStatusToOrderStatus } from '@/lib/integrations/ameex'
import { getAmeexCredentials } from '@/lib/integrations/ameex-credentials'

export async function GET(request: Request) {
  try {
    assertTrustedOrigin(request)
    await requireAuthenticatedUser()

    const { searchParams } = new URL(request.url)
    const trackingNumber = searchParams.get('trackingNumber') || ''
    const storeId = searchParams.get('storeId') || ''

    if (!trackingNumber) return NextResponse.json({ error: 'MISSING_TRACKING_NUMBER' }, { status: 400 })
    if (!storeId) return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })

    const admin = createAdminClient()

    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id')
      .eq('provider', 'ameex')
      .eq('store_id', storeId)
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration) return NextResponse.json({ error: 'AMEEX_NOT_CONNECTED' }, { status: 400 })

    const credentials = await getAmeexCredentials(admin, integration.id)

    const { data: config } = await admin
      .from('ameex_configs')
      .select('business_id')
      .eq('store_id', storeId)
      .maybeSingle()

    const raw = await trackAmeexParcel(credentials.apiId, credentials.apiKey, trackingNumber)
    const parcel = (raw as any)?.Parcel
    const rawStatut = String(parcel?.STATUT || '').trim()
    const rawStatutS = String(parcel?.STATUT_S || '').trim()
    const mapped = mapAmeexStatusToOrderStatus(rawStatut, rawStatutS || undefined)

    return NextResponse.json({
      ok: true,
      rawStatus: mapped.rawStatus,
      orderStatus: mapped.orderStatus,
      deliveryStatus: mapped.deliveryStatus,
      statusDateField: mapped.statusDateField,
      raw,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AMEEX_TRACK_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}