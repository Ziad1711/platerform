import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { listMarocGoDeliveryCities, listMarocGoDeliveryShops, listMarocGoDeliveryStates } from '@/lib/integrations/maroc-go-delivery'
import {
  getDecryptedIntegrationToken,
  getMarocGoDeliveryProviderId,
  syncDeliveryShops,
  syncDeliveryStates,
  syncPricingGroups,
} from '@/lib/integrations/maroc-go-delivery-connect'

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
      .from('maroc_go_delivery_configs')
      .select('integration_id')
      .eq('store_id', storeId)
      .maybeSingle()

    if (configError) throw configError
    if (!config?.integration_id) {
      return NextResponse.json({ error: 'MAROC_GO_DELIVERY_NOT_CONNECTED' }, { status: 400 })
    }

    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id, status')
      .eq('id', config.integration_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration || integration.status !== 'connected') {
      return NextResponse.json({ error: 'MAROC_GO_DELIVERY_NOT_CONNECTED' }, { status: 400 })
    }

    const token = await getDecryptedIntegrationToken(admin, integration.id)
    const providerId = await getMarocGoDeliveryProviderId(admin)

    const [shops, cities, states, mappedShopsResult] = await Promise.all([
      listMarocGoDeliveryShops(token),
      listMarocGoDeliveryCities(token),
      listMarocGoDeliveryStates(token),
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

    // Réparer les aliases orphelins (city_key = 0) à partir du référentiel synchronisé
    if (cities.length > 0) {
      const { error: aliasSyncError } = await admin
        .from('maroc_go_delivery_city_aliases')
        .update({ updated_at: new Date().toISOString() })
        .eq('city_key', 0)

      if (aliasSyncError) throw aliasSyncError

      for (const city of cities) {
        await admin
          .from('maroc_go_delivery_city_aliases')
          .update({ city_key: city.key, canonical_city_name: city.city_name, updated_at: new Date().toISOString() })
          .eq('canonical_city_name', city.city_name)
          .eq('city_key', 0)
      }
    }

    return NextResponse.json({
      ok: true,
      shops: shops.length,
      cities: cities.length,
      states: states.length,
      pricingGroupType: pricingResult.isCustom ? 'custom' : 'default',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MAROC_GO_DELIVERY_SYNC_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
