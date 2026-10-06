import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { listRushlivCities } from '@/lib/integrations/rushliv'
import {
  getDecryptedIntegrationToken,
  getRushlivProviderId,
  syncRushlivCities,
} from '@/lib/integrations/rushliv-connect'

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
      .from('rushliv_configs')
      .select('integration_id')
      .eq('store_id', storeId)
      .maybeSingle()

    if (configError) throw configError
    if (!config?.integration_id) {
      return NextResponse.json({ error: 'RUSHLIV_NOT_CONNECTED' }, { status: 400 })
    }

    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id, status')
      .eq('id', config.integration_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration || integration.status !== 'connected') {
      return NextResponse.json({ error: 'RUSHLIV_NOT_CONNECTED' }, { status: 400 })
    }

    await getDecryptedIntegrationToken(admin, integration.id)
    const providerId = await getRushlivProviderId(admin)

    const cities = await listRushlivCities()

    const pricingResult = await syncRushlivCities({
      client: admin,
      providerId,
      integrationId: integration.id,
      userId: user.id,
      cities,
    })

    // Réparer les aliases orphelins (city_key = 0) à partir du référentiel synchronisé
    if (cities.length > 0) {
      for (const city of cities) {
        await admin
          .from('rushliv_city_aliases')
          .update({ city_key: String(city.id), canonical_city_name: city.name, updated_at: new Date().toISOString() })
          .eq('canonical_city_name', city.name)
          .eq('city_key', '')
      }
    }

    return NextResponse.json({
      ok: true,
      cities: cities.length,
      created: pricingResult.created,
      pricingGroupType: pricingResult.isCustom ? 'custom' : 'default',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RUSHLIV_SYNC_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
