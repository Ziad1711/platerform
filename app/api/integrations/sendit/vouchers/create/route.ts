import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { getSenditLabels } from '@/lib/integrations/sendit'
import { getSenditCredentials } from '@/lib/integrations/sendit-credentials'

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      orderIds?: string[]
      integrationId?: string
      storeId?: string
      printFormat?: number
    }

    const orderIds = body.orderIds || []
    let integrationId = String(body.integrationId || '').trim()
    const storeId = String(body.storeId || '').trim()
    const printFormat = Number(body.printFormat || 1)

    if (!orderIds.length) return NextResponse.json({ error: 'MISSING_ORDER_IDS' }, { status: 400 })
    if (!storeId) return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })

    await verifyStoreAccess(supabase, user.id, storeId)

    const admin = createAdminClient()

    // Résoudre integrationId depuis le store si non fourni
    if (!integrationId) {
      const { data: senditConfig } = await admin
        .from('sendit_configs')
        .select('integration_id')
        .eq('store_id', storeId)
        .maybeSingle()

      if (senditConfig?.integration_id) {
        integrationId = senditConfig.integration_id
      }
    }

    if (!integrationId) return NextResponse.json({ error: 'MISSING_INTEGRATION_ID' }, { status: 400 })

    // Récupérer les codes colis Sendit
    const { data: orders } = await admin
      .from('orders')
      .select('id, sendit_parcel_code, tracking_number')
      .in('id', orderIds)
      .eq('store_id', storeId)

    if (!orders?.length) return NextResponse.json({ error: 'NO_ORDERS_FOUND' }, { status: 404 })

    const parcelCodes = orders
      .map((o) => String(o.sendit_parcel_code || o.tracking_number || '').trim())
      .filter(Boolean)

    if (!parcelCodes.length) {
      return NextResponse.json({ error: 'NO_SENDIT_PARCEL_CODES' }, { status: 400 })
    }

    const credentials = await getSenditCredentials(admin, integrationId)
    const raw = await getSenditLabels(credentials.token, parcelCodes, printFormat)
    // L'API Sendit /deliveries/getlabels retourne { success, message, data: { filePrint, fileUrl } }
    const fileUrl = String((raw as any)?.data?.fileUrl || (raw as any)?.fileUrl || '').trim()

    if (!fileUrl) {
      const rawMsg = (raw as any)?.message || JSON.stringify(raw)
      console.error('[SENDIT_VOUCHER_CREATE] empty fileUrl, raw response:', rawMsg)
      return NextResponse.json({ error: `SENDIT_VOUCHER_CREATE_FAILED: ${rawMsg}` }, { status: 500 })
    }

    // Générer un voucherKey stable à partir du fileUrl
    const voucherKey = `SENDIT-${parcelCodes[0]}-${Date.now()}`

    // Récupérer le provider_id sendit
    const { data: provider } = await admin
      .from('integration_providers')
      .select('id')
      .eq('slug', 'sendit')
      .maybeSingle()

    const now = new Date().toISOString()

    // Sauvegarder dans delivery_entity_mappings (pour l'affichage dans la liste des bons)
    const { error: mappingError } = await admin.from('delivery_entity_mappings').upsert({
      provider_id: provider?.id || null,
      integration_id: integrationId,
      user_id: user.id,
      store_id: storeId,
      entity_type: 'voucher',
      provider_entity_id: voucherKey,
      internal_id: voucherKey,
      payload: {
        fileUrl,
        parcelCodes,
        count: parcelCodes.length,
        provider_slug: 'sendit',
      },
      created_at: now,
      updated_at: now,
    }, { onConflict: 'integration_id,entity_type,provider_entity_id' })

    if (mappingError) {
      console.error('[SENDIT_VOUCHER_CREATE] mapping error:', mappingError)
    }

    // Mettre à jour les commandes avec sendit_voucher_key
    const orderIdsToUpdate = orders.map((o) => o.id)
    if (orderIdsToUpdate.length > 0) {
      const { error: updateError } = await admin
        .from('orders')
        .update({
          sendit_voucher_key: voucherKey,
          delivery_status: 'pickup_pending',
          updated_at: now,
        })
        .in('id', orderIdsToUpdate)
        .eq('store_id', storeId)

      if (updateError) {
        console.error('[SENDIT_VOUCHER_CREATE] order update error:', updateError)
      }
    }

    return NextResponse.json({
      ok: true,
      voucherKey,
      voucherUrl: fileUrl,
      parcelCodes,
      totalParcels: parcelCodes.length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SENDIT_VOUCHER_CREATE_FAILED'
    console.error('[SENDIT_VOUCHER_CREATE] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
