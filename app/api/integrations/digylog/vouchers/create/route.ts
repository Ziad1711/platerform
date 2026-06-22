import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createOrders, DigylogConfig, DigylogCreateOrdersPayload } from '@/lib/integrations/digylog'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const { storeId, orderIds } = await req.json()
    if (!storeId || !orderIds?.length) {
      return NextResponse.json({ error: 'storeId et orderIds requis' }, { status: 400 })
    }

    // Récupérer l'intégration Digylog
    const { data: integration } = await supabase
      .from('integrations')
      .select('id, config')
      .eq('user_id', user.id)
      .eq('provider_id', 'eeeb5b4f-741b-4d53-b4dd-72a7bd26f9cf')
      .eq('status', 'active')
      .maybeSingle()

    if (!integration) {
      return NextResponse.json({ error: 'Intégration Digylog introuvable' }, { status: 404 })
    }

    const cfg: DigylogConfig = integration.config as DigylogConfig

    // Récupérer les commandes
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id, customer_name, phone, city, address, total_selling_price, tracking_number, delivery_city_external_id')
      .in('id', orderIds)
      .eq('store_id', storeId)

    if (ordersError) throw ordersError
    if (!orders?.length) {
      return NextResponse.json({ error: 'Aucune commande trouvée' }, { status: 404 })
    }

    // Récupérer la config Digylog pour le store
    const { data: digylogConfig } = await supabase
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
      orders: orders.map((o) => ({
        num: o.tracking_number || `ORDER-${o.id}`,
        name: o.customer_name || 'Client',
        phone: o.phone || '',
        address: o.address || '',
        city: o.delivery_city_external_id || o.city || '',
        price: Number(o.total_selling_price) || 0,
      })),
    }

    const result = await createOrders(cfg, payload)

    // Mettre à jour les commandes avec le BL créé
    if (result?.bl) {
      const blId = result.bl
      await supabase
        .from('orders')
        .update({ delivery_voucher_key: String(blId) })
        .in('id', orderIds)
        .eq('store_id', storeId)

      // Enregistrer dans delivery_entity_mappings
      await supabase
        .from('delivery_entity_mappings')
        .insert({
          store_id: storeId,
          integration_id: integration.id,
          entity_type: 'voucher',
          provider_entity_id: String(blId),
          payload: {
            provider_slug: 'digylog',
            count: orders.length,
            parcels: orders.map((o) => o.tracking_number),
          },
        })
    }

    return NextResponse.json({
      success: true,
      voucherKey: String(result?.bl || ''),
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
