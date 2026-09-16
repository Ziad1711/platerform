import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { listMarocGoDeliveryCities, listMarocGoDeliveryShops } from '@/lib/integrations/maroc-go-delivery'
import { encryptSecret } from '@/lib/security/crypto'
import {
  getMarocGoDeliveryProviderId,
  syncDeliveryShops,
  syncPricingGroups,
} from '@/lib/integrations/maroc-go-delivery-connect'

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
      .from('maroc_go_delivery_configs')
      .select('integration_id')
      .eq('store_id', storeId)
      .maybeSingle()

    if (configError) throw configError
    if (!config?.integration_id) {
      return NextResponse.json({ error: 'MAROC_GO_DELIVERY_NOT_CONNECTED' }, { status: 400 })
    }

    const [cities, shops] = await Promise.all([
      listMarocGoDeliveryCities(apiToken),
      listMarocGoDeliveryShops(apiToken),
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
      .from('maroc_go_delivery_configs')
      .update({ api_token: encryptedToken, updated_at: now })
      .eq('store_id', storeId)

    if (configUpdateError) throw configUpdateError

    const providerId = await getMarocGoDeliveryProviderId(admin)

    const pricingResult = await syncPricingGroups({
      client: admin,
      providerId,
      integrationId,
      userId: user.id,
      cities,
    })

    const { data: mappedShops } = await admin
      .from('delivery_shops')
      .select('external_shop_id, store_id')
      .eq('integration_id', integrationId)

    await syncDeliveryShops({
      client: admin,
      integrationId,
      providerId,
      shops,
      mappings: (mappedShops || []).map((row) => ({
        externalShopId: Number(row.external_shop_id),
        storeId: row.store_id ? String(row.store_id) : null,
      })),
      pricingGroupId: pricingResult.pricingGroupId,
    })

    // Créer delivery_companies si manquant pour ce store
    const { data: existingDc } = await admin
      .from('delivery_companies')
      .select('id')
      .eq('store_id', storeId)
      .eq('name', 'Maroc Go Delivery')
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
          name: 'Maroc Go Delivery',
          api_provider: 'maroc-go-delivery',
          is_active: true,
          created_at: now,
        })
      if (insertError) console.error('Failed to insert delivery_company:', insertError)
    }

    return NextResponse.json({ ok: true, shops: shops.length, cities: cities.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MAROC_GO_DELIVERY_TOKEN_UPDATE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
