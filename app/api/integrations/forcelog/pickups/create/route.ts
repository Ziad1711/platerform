import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { createForceLogPickupRequest } from '@/lib/integrations/forcelog'
import { getDecryptedIntegrationToken } from '@/lib/integrations/rapid-delivery-connect'

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      storeId?: string
      orderIds?: string[]
      pickupPhone?: string
      pickupCityKey?: string
      pickupCityName?: string
      pickupAddress?: string
      pickupStickers?: boolean
    }

    const storeId = String(body.storeId || '').trim()
    const orderIds = Array.isArray(body.orderIds) ? body.orderIds.map(String).filter(Boolean) : []

    if (!storeId) return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    if (orderIds.length === 0) return NextResponse.json({ error: 'MISSING_ORDER_IDS' }, { status: 400 })

    await verifyStoreAccess(supabase, user.id, storeId)

    const admin = createAdminClient()

    // Récupérer l'intégration ForceLog
    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id, status, provider_id')
      .eq('user_id', user.id)
      .eq('provider', 'forcelog')
      .eq('store_id', storeId)
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration || integration.status !== 'connected') {
      return NextResponse.json({ error: 'FORCELOG_NOT_CONNECTED' }, { status: 400 })
    }

    // Récupérer la config ForceLog
    const { data: config } = await admin
      .from('forcelog_configs')
      .select('*')
      .eq('store_id', storeId)
      .maybeSingle()

    // Utiliser les valeurs du body en priorité, sinon fallback sur la config DB
    const pickupPhone = (body.pickupPhone || config?.pickup_phone || '').slice(0, 14)
    const pickupCityKey = (body.pickupCityKey || config?.pickup_city_key || '').slice(0, 50)
    const pickupCityName = body.pickupCityName || config?.pickup_city_name || pickupCityKey
    const pickupAddress = (body.pickupAddress || config?.pickup_address || '').slice(0, 100)
    const pickupStickers = body.pickupStickers !== undefined ? body.pickupStickers : (config?.pickup_stickers || false)

    if (!pickupPhone || !pickupCityKey || !pickupAddress) {
      return NextResponse.json({ error: 'FORCELOG_PICKUP_CONFIG_INCOMPLETE', message: 'Paramètres de ramassage incomplets. Veuillez fournir téléphone, ville et adresse de ramassage.' }, { status: 400 })
    }

    // Vérifier que toutes les commandes ont un colis créé
    const { data: orders } = await admin
      .from('orders')
      .select('id, forcelog_parcel_key, tracking_number, delivery_voucher_key, forcelog_pickup_key, status')
      .in('id', orderIds)
      .eq('store_id', storeId)

    if (!orders || orders.length === 0) {
      return NextResponse.json({ error: 'NO_ORDERS_FOUND' }, { status: 404 })
    }

    const parcelKeys = orders
      .map((o) => o.forcelog_parcel_key || o.tracking_number || '')
      .filter(Boolean)

    if (parcelKeys.length === 0) {
      return NextResponse.json({ error: 'NO_PARCELS_FOUND', message: 'Aucun colis ForceLog trouvé pour ces commandes.' }, { status: 400 })
    }

    // Générer une clé interne pour le pickup
    const internalPickupKey = `fl_pickup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // Appeler l'API ForceLog pour créer la demande de ramassage
    const apiKey = await getDecryptedIntegrationToken(admin, integration.id)
    const pickupResult = await createForceLogPickupRequest(apiKey, {
      PHONE: pickupPhone,
      CITY: pickupCityKey,
      ADDRESS: pickupAddress,
      STICKERS: pickupStickers,
    })

    if (pickupResult?.['ADD-PICKUP']?.RESULT === 'ERROR') {
      throw new Error(`FORCELOG_PICKUP_FAILED:${pickupResult['ADD-PICKUP']?.MESSAGE || 'Unknown error'}`)
    }

    // Mettre à jour les commandes
    const now = new Date().toISOString()
    const updatePayload: Record<string, unknown> = {
      forcelog_pickup_key: internalPickupKey,
      delivery_voucher_key: internalPickupKey,
      delivery_status: 'pickup_pending',
      status: 'dl_pickup_pending',
      dl_pickup_pending_at: now,
      delivery_status_source: 'delivery_company',
      last_delivery_sync_at: now,
      updated_at: now,
    }

    const { error: updateError } = await admin
      .from('orders')
      .update(updatePayload)
      .in('id', orderIds)

    if (updateError) throw updateError

    // Sauvegarder dans delivery_entity_mappings pour l'affichage dans la liste des bons
    const { error: mappingError } = await admin.from('delivery_entity_mappings').upsert({
      provider_id: integration.provider_id,
      integration_id: integration.id,
      user_id: user.id,
      store_id: storeId,
      entity_type: 'voucher',
      provider_entity_id: internalPickupKey,
      internal_id: internalPickupKey,
      payload: {
        provider_slug: 'forcelog',
        parcels: parcelKeys,
        count: parcelKeys.length,
        pickup_phone: pickupPhone,
        pickup_city_key: pickupCityKey,
        pickup_city_name: pickupCityName,
        pickup_address: pickupAddress,
        pickup_stickers: pickupStickers,
      },
      created_at: now,
      updated_at: now,
    }, { onConflict: 'integration_id,entity_type,provider_entity_id' })

    if (mappingError) throw mappingError

    return NextResponse.json({
      ok: true,
      pickupKey: internalPickupKey,
      totalParcels: parcelKeys.length,
      raw: pickupResult,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FORCELOG_PICKUP_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}