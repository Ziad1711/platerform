import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { createAmeexParcelForOrder } from '@/lib/integrations/delivery/ameex-adapter'

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      orderId?: string
      storeId?: string
      deliveryNote?: string
      parcelType?: string
      canOpen?: boolean
      fragile?: boolean
      replace?: boolean
      tryEnabled?: boolean
    }

    const orderId = String(body.orderId || '').trim()
    const storeId = String(body.storeId || '').trim()

    if (!orderId || !storeId) return NextResponse.json({ error: 'MISSING_REQUIRED_FIELDS' }, { status: 400 })

    await verifyStoreAccess(supabase, user.id, storeId)
    const admin = createAdminClient()

    // Recuperer l'integration AMEEX
    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('provider', 'ameex')
      .eq('store_id', storeId)
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration || integration.status !== 'connected') {
      return NextResponse.json({ error: 'AMEEX_NOT_CONNECTED' }, { status: 400 })
    }

    const result = await createAmeexParcelForOrder({
      admin,
      orderId,
      storeId,
      userId: user.id,
      integrationId: integration.id,
      deliveryNote: body.deliveryNote || undefined,
      parcelType: body.parcelType,
      canOpen: body.canOpen,
      fragile: body.fragile,
      replace: body.replace,
      tryEnabled: body.tryEnabled,
    })

    if (result.warning) {
      return NextResponse.json({ ok: true, warning: result.warning, trackingNumber: result.trackingNumber })
    }

    return NextResponse.json({ ok: true, trackingNumber: result.trackingNumber })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AMEEX_PARCEL_CREATE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}