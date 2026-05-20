import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { listRapidDeliveryCities, listRapidDeliveryShops, listRapidDeliveryStates } from '@/lib/integrations/rapid-delivery'
import {
  getRapidDeliveryIntegrationCredentials,
  getRapidDeliveryProviderId,
  syncDeliveryShops,
  syncDeliveryStates,
  syncLegacyRapidDeliveryData,
  syncPricingGroups,
} from '@/lib/integrations/rapid-delivery-connect'

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as { storeId?: string }
    const storeId = String(body.storeId || '').trim()

    if (!storeId) return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
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

    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id, status')
      .eq('id', config.integration_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration || integration.status !== 'connected') {
      return NextResponse.json({ error: 'RAPID_DELIVERY_NOT_CONNECTED' }, { status: 400 })
    }

    const { token, baseUrl } = await getRapidDeliveryIntegrationCredentials(admin, integration.id)
    const providerId = await getRapidDeliveryProviderId(admin)

    const [shops, cities, states, mappedShopsResult] = await Promise.all([
      listRapidDeliveryShops(token, baseUrl),
      listRapidDeliveryCities(token, baseUrl),
      listRapidDeliveryStates(token, baseUrl),
      admin
        .from('delivery_shops')
        .select('external_shop_id, store_id')
        .eq('integration_id', integration.id),
    ])

    if (mappedShopsResult.error) throw mappedShopsResult.error

    const pricingResult = await syncPricingGroups({
      client: admin,
      providerId,
      integrationId: integration.id,
      userId: user.id,
      cities,
    })

    await syncDeliveryShops({
      client: admin,
      integrationId: integration.id,
      providerId,
      shops,
      mappings: (mappedShopsResult.data || []).map((row) => ({
        externalShopId: Number(row.external_shop_id),
        storeId: row.store_id ? String(row.store_id) : null,
      })),
      pricingGroupId: pricingResult.pricingGroupId,
    })

    await syncDeliveryStates(admin, providerId, states)
    await syncLegacyRapidDeliveryData({
      client: admin,
      integrationId: integration.id,
      userId: user.id,
      storeIds: [storeId],
      encryptedToken: (await admin.from('integrations').select('access_token').eq('id', integration.id).single()).data?.access_token || '',
      shops,
      cities,
    })

    if (cities.length > 0) {
      const { error: aliasSyncError } = await admin
        .from('rapid_delivery_city_aliases')
        .update({ updated_at: new Date().toISOString() })
        .eq('city_key', 0)

      if (aliasSyncError) throw aliasSyncError

      for (const city of cities) {
        await admin
          .from('rapid_delivery_city_aliases')
          .update({ city_key: city.key, canonical_city_name: city.city_name, updated_at: new Date().toISOString() })
          .eq('canonical_city_name', city.city_name)
          .eq('city_key', 0)
      }
    }

    return NextResponse.json({ ok: true, shops: shops.length, cities: cities.length, states: states.length, pricingGroupType: pricingResult.isCustom ? 'custom' : 'default' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RAPID_DELIVERY_SYNC_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}