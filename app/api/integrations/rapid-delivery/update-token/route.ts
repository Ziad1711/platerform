import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { listRapidDeliveryCities, listRapidDeliveryShops } from '@/lib/integrations/rapid-delivery'
import { encryptSecret } from '@/lib/security/crypto'

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as { storeId?: string; apiToken?: string }
    const storeId = String(body.storeId || '').trim()
    const apiToken = String(body.apiToken || '').trim()

    if (!storeId) return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    if (!apiToken) return NextResponse.json({ error: 'MISSING_API_TOKEN' }, { status: 400 })
    await verifyStoreAccess(supabase, user.id, storeId)

    const admin = createAdminClient()
    const { data: config, error: configError } = await admin
      .from('rapid_delivery_configs')
      .select('integration_id')
      .eq('store_id', storeId)
      .maybeSingle()

    if (configError) throw configError
    if (!config?.integration_id) {
      return NextResponse.json({ error: 'RAPID_DELIVERY_NOT_CONNECTED' }, { status: 400 })
    }

    const [cities, shops] = await Promise.all([
      listRapidDeliveryCities(apiToken),
      listRapidDeliveryShops(apiToken),
    ])

    const now = new Date().toISOString()
    const integrationId = config.integration_id
    const encryptedToken = encryptSecret(apiToken)

    const { error: integrationError } = await admin
      .from('integrations')
      .update({ access_token: encryptedToken, status: 'connected', store_id: storeId, updated_at: now })
      .eq('id', integrationId)
      .eq('user_id', user.id)


    if (integrationError) throw integrationError

    const { error: configUpdateError } = await admin
      .from('rapid_delivery_configs')
      .update({ api_token: encryptedToken, updated_at: now })
      .eq('store_id', storeId)

    if (configUpdateError) throw configUpdateError

    if (shops.length > 0) {
      const { error: shopsError } = await admin.from('rapid_delivery_shops').upsert(
        shops.map((shop) => ({
          integration_id: integrationId,
          shop_key: shop.key,
          name: shop.name,
          phone: shop.phone || null,
          allow_opening_parcels: Boolean(shop.allow_opening_parcels),
          updated_at: now,
        })),
        { onConflict: 'integration_id,shop_key' }
      )

      if (shopsError) throw shopsError
    }

    if (cities.length > 0) {
      const { error: standardError } = await admin.from('rapid_delivery_cities_standard').upsert(
        cities.map((city) => ({
          city_key: city.key,
          city_name: city.city_name,
          cost_delivery: city.cost_delivery,
          cost_refuse: city.cost_refuse,
          cost_cancel: city.cost_cancel,
          updated_at: now,
        })),
        { onConflict: 'city_key' }
      )

      if (standardError) throw standardError

      const { error: citiesError } = await admin.from('rapid_delivery_cities').upsert(
        cities.map((city) => ({
          integration_id: integrationId,
          city_key: city.key,
          city_name: city.city_name,
          cost_delivery: city.cost_delivery,
          cost_refuse: city.cost_refuse,
          cost_cancel: city.cost_cancel,
          updated_at: now,
        })),
        { onConflict: 'integration_id,city_key' }
      )

      if (citiesError) throw citiesError
    }

    // Créer delivery_companies si manquant pour ce store
    const { data: existingDc } = await admin
      .from('delivery_companies')
      .select('id')
      .eq('store_id', storeId)
      .eq('name', 'Rapid Delivery')
      .maybeSingle()

    if (existingDc) {
      const { error: updateError } = await admin
        .from('delivery_companies')
        .update({ is_active: true, updated_at: now })
        .eq('id', existingDc.id)
      if (updateError) console.error('Failed to update delivery_company:', updateError)
    } else {
      const { error: insertError } = await admin
        .from('delivery_companies')
        .insert({
          store_id: storeId,
          name: 'Rapid Delivery',
          api_provider: 'rapid-delivery',
          is_active: true,
          created_at: now,
        })
      if (insertError) console.error('Failed to insert delivery_company:', insertError)
    }

    return NextResponse.json({ ok: true, shops: shops.length, cities: cities.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RAPID_DELIVERY_TOKEN_UPDATE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
