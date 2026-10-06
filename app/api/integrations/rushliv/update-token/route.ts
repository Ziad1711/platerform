import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { listRushlivCities } from '@/lib/integrations/rushliv'
import { encryptSecret } from '@/lib/security/crypto'
import { getRushlivProviderId, syncRushlivCities } from '@/lib/integrations/rushliv-connect'

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
      .from('rushliv_configs')
      .select('integration_id')
      .eq('store_id', storeId)
      .maybeSingle()

    if (configError) throw configError
    if (!config?.integration_id) {
      return NextResponse.json({ error: 'RUSHLIV_NOT_CONNECTED' }, { status: 400 })
    }

    const cities = await listRushlivCities()
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
      .from('rushliv_configs')
      .update({ api_token: encryptedToken, updated_at: now })
      .eq('store_id', storeId)

    if (configUpdateError) throw configUpdateError

    const providerId = await getRushlivProviderId(admin)
    await syncRushlivCities({
      client: admin,
      providerId,
      integrationId,
      userId: user.id,
      cities,
    })

    return NextResponse.json({ ok: true, cities: cities.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RUSHLIV_TOKEN_UPDATE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
