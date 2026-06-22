import { NextResponse } from 'next/server'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const url = new URL(request.url)
    const storeId = url.searchParams.get('storeId')

    if (!storeId) {
      return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    }

    await verifyStoreAccess(supabase, user.id, storeId)

    const { data: config } = await supabase
      .from('digylog_configs')
      .select('*')
      .eq('store_id', storeId)
      .maybeSingle()

    return NextResponse.json({ ok: true, data: config || null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'DIGYLOG_CONFIG_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json()) as {
      storeId: string
      defaultNetworkId?: number
      defaultOrderMode?: number
      defaultSendStatus?: number
      defaultExternalStore?: string
      checkDuplicate?: number
      openProduct?: number
      port?: number
      webhookUrl?: string
    }

    const { storeId } = body
    if (!storeId) {
      return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    }

    await verifyStoreAccess(supabase, user.id, storeId)

    const updateData: Record<string, any> = {
      default_network_id: body.defaultNetworkId,
      default_order_mode: body.defaultOrderMode,
      default_send_status: body.defaultSendStatus,
      default_external_store: body.defaultExternalStore,
      check_duplicate: body.checkDuplicate,
      openproduct_default: body.openProduct,
      port_default: body.port,
      webhook_url: body.webhookUrl,
      updated_at: new Date().toISOString(),
    }

    // Nettoyer les undefined
    Object.keys(updateData).forEach((k) => {
      if (updateData[k] === undefined) delete updateData[k]
    })

    const { data: existing } = await supabase
      .from('digylog_configs')
      .select('id')
      .eq('store_id', storeId)
      .maybeSingle()

    if (existing?.id) {
      await supabase.from('digylog_configs').update(updateData).eq('id', existing.id)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'DIGYLOG_CONFIG_UPDATE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
