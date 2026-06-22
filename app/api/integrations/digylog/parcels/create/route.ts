import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { createDigylogParcelForOrder } from '@/lib/integrations/delivery/digylog-adapter'

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json()) as {
      storeId: string
      orderId: string
      integrationId: string
      deliveryNote?: string
      networkId?: number
      orderMode?: 1 | 2
      sendStatus?: 0 | 1
      checkDuplicate?: 0 | 1
      openProduct?: 1 | 2
      port?: 1 | 2
      externalStore?: string
    }

    const { storeId, orderId, integrationId } = body
    if (!storeId || !orderId || !integrationId) {
      return NextResponse.json({ error: 'MISSING_REQUIRED_FIELDS' }, { status: 400 })
    }

    await verifyStoreAccess(supabase, user.id, storeId)

    const admin = createAdminClient()
    const result = await createDigylogParcelForOrder({
      admin,
      orderId,
      storeId,
      userId: user.id,
      integrationId,
      deliveryNote: body.deliveryNote,
      networkId: body.networkId,
      orderMode: body.orderMode,
      sendStatus: body.sendStatus,
      checkDuplicate: body.checkDuplicate,
      openProduct: body.openProduct,
      port: body.port,
      externalStore: body.externalStore,
    })

    if (result.warning) {
      return NextResponse.json({ ok: false, warning: result.warning, trackingNumber: result.trackingNumber }, { status: 400 })
    }

    return NextResponse.json({ ok: true, trackingNumber: result.trackingNumber })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'DIGYLOG_PARCEL_CREATE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
