import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'

const isMissingDbObjectError = (error: any) => ['42P01', '42703'].includes(error?.code)

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

    if (configError && !isMissingDbObjectError(configError)) throw configError
    const integrationId = String(config?.integration_id || '')

    const { error: storeIntegrationError } = await admin
      .from('store_integrations')
      .delete()
      .eq('store_id', storeId)
      .eq('provider_slug', 'rapid-delivery')

    if (storeIntegrationError && !isMissingDbObjectError(storeIntegrationError)) throw storeIntegrationError

    const { error: deleteConfigError } = await admin.from('rapid_delivery_configs').delete().eq('store_id', storeId)
    if (deleteConfigError && !isMissingDbObjectError(deleteConfigError)) throw deleteConfigError

    if (integrationId) {
      const { data: remainingConfigs, error: remainingError } = await admin
        .from('rapid_delivery_configs')
        .select('store_id')
        .eq('integration_id', integrationId)
        .limit(1)

      if (remainingError && !isMissingDbObjectError(remainingError)) throw remainingError

      if (!remainingConfigs || remainingConfigs.length === 0) {
        const purgeTargets = [
          'rapid_delivery_shops',
          'rapid_delivery_cities',
          'rapid_delivery_cities_custom',
          'rapid_delivery_entity_mappings',
          'delivery_shops',
        ]

        for (const table of purgeTargets) {
          const { error } = await admin.from(table).delete().eq('integration_id', integrationId)
          if (error && !isMissingDbObjectError(error)) throw error
        }

        const { error: integrationDeleteError } = await admin
          .from('integrations')
          .delete()
          .eq('id', integrationId)
          .eq('user_id', user.id)

        if (integrationDeleteError && !isMissingDbObjectError(integrationDeleteError)) throw integrationDeleteError
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RAPID_DELIVERY_DISCONNECT_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}