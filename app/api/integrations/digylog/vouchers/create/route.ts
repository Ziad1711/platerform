import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { createOrders, DigylogConfig, DigylogCreateOrdersPayload } from '@/lib/integrations/digylog'

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      storeId?: string
      orderIds?: string[]
    }

    const storeId = String(body.storeId || '').trim()
    const orderIds = Array.isArray(body.orderIds) ? body.orderIds.map(String).filter(Boolean) : []

    if (!storeId || orderIds.length === 0) {
      return NextResponse.json({ error: 'storeId et orderIds requis' }, { status: 400 })
    }

    await verifyStoreAccess(supabase, user.id, storeId)

    const admin = createAdminClient()

    // Récupérer l'intégration Digylog
    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id, provider_id, access_token')
      .eq('user_id', user.id)
      .eq('provider_id', 'eeeb5b4f-741b-4d53-b4dd-72a7bd26f9cf')
      .eq('status', 'connected')
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration?.access_token) {
      return NextResponse.json({ error: 'Intégration Digylog introuvable' }, { status: 404 })
    }

    const cfg: DigylogConfig = { token: integration.access_token, referer: 'https://apiseller.digylog.com' }

    // Récupérer les commandes avec leurs articles
    const { data: orders, error: ordersError } = await admin
      .from('orders')
      .select(`
        id, customer_name, phone, city, address, total_selling_price, tracking_number,
        order_items(quantity, products(name))
      `)
      .in('id', orderIds)
      .eq('store_id', storeId)

    if (ordersError) throw ordersError
    if (!orders?.length) {
      return NextResponse.json({ error: 'Aucune commande trouvée' }, { status: 404 })
    }

    // Récupérer la config Digylog pour le store
    const { data: digylogConfig } = await admin
      .from('digylog_configs')
      .select('default_network_id, default_external_store, default_order_mode, default_send_status')
      .eq('store_id', storeId)
      .maybeSingle()

    if (!digylogConfig) {
      return NextResponse.json({ error: 'Configuration Digylog introuvable' }, { status: 400 })
    }

    // Construire le payload
    const payload: DigylogCreateOrdersPayload = {
      mode: (digylogConfig.default_order_mode || 1) as 1 | 2,
      network: digylogConfig.default_network_id || 1,
      store: digylogConfig.default_external_store || storeId,
      status: (digylogConfig.default_send_status ?? 1) as 0 | 1,
      checkDuplicate: 1,
      orders: orders.map((o: any) => {
        const items = o.order_items || []
        const refs = items.length > 0
          ? items.map((oi: any) => ({
              ref: '',
              designation: oi.products?.name || 'Produit',
              quantity: Number(oi.quantity) || 1,
            }))
          : [{ ref: '', designation: 'Produit', quantity: 1 }]

        return {
          num: o.tracking_number || `ORDER-${o.id}`,
          type: 1,
          name: o.customer_name || 'Client',
          phone: o.phone || '',
          address: o.address || '',
          city: o.city || '',
          price: Number(o.total_selling_price) || 0,
          port: 2,
          openproduct: 1,
          refs,
        }
      }),
    }

    const raw = await createOrders(cfg, payload)

    // Vérifier les erreurs métier Digylog (tableau avec isSuccess)
    let result: any = raw
    if (Array.isArray(raw)) {
      const failed = raw.find((r: any) => r.isSuccess === false)
      if (failed) {
        const errMsg = failed.errors?.join('; ') || 'Erreur inconnue'
        return NextResponse.json({ error: `DIGYLOG_ORDER_FAILED:${errMsg}` }, { status: 400 })
      }
      result = raw[0] || {}
    }

    // Générer un ID de voucher (soit le BL Digylog, soit un hash des trackings)
    const voucherKey = String(result?.bl || result?.tracking || result?.num || `DIGYLOG-${Date.now()}`)

    const now = new Date().toISOString()

    // Mettre à jour les commandes avec le voucher key
    const { error: updateError } = await admin
      .from('orders')
      .update({
        delivery_voucher_key: voucherKey,
        delivery_status: 'pickup_pending',
        updated_at: now,
      })
      .in('id', orderIds)
      .eq('store_id', storeId)

    if (updateError) throw updateError

    // Enregistrer dans delivery_entity_mappings (upsert pour éviter les doublons)
    const { error: mappingError } = await admin
      .from('delivery_entity_mappings')
      .upsert({
        provider_id: integration.provider_id,
        integration_id: integration.id,
        user_id: user.id,
        store_id: storeId,
        entity_type: 'voucher',
        provider_entity_id: voucherKey,
        internal_id: orderIds[0],
        payload: {
          provider_slug: 'digylog',
          count: orders.length,
          parcels: orders.map((o) => o.tracking_number),
          order_ids: orderIds,
        },
        created_at: now,
        updated_at: now,
      }, { onConflict: 'integration_id,entity_type,provider_entity_id' })

    if (mappingError) throw mappingError

    return NextResponse.json({
      success: true,
      voucherKey,
      count: orders.length,
    })
  } catch (error) {
    console.error('Digylog voucher create error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur lors de la création du bon' },
      { status: 500 }
    )
  }
}
