import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser } from '@/lib/assistant/security'
import { listRapidDeliveryCities, listRapidDeliveryShops, listRapidDeliveryStates } from '@/lib/integrations/rapid-delivery'
import { encryptSecret } from '@/lib/security/crypto'
import {
  getRapidDeliveryProviderId,
  syncDeliveryShops,
  syncDeliveryStates,
  syncLegacyRapidDeliveryData,
  syncPricingGroups,
  type RapidDeliveryShopMappingInput,
} from '@/lib/integrations/rapid-delivery-connect'

function toRapidDeliveryErrorMessage(error: unknown) {
  console.error('Rapid Delivery connect error:', error)

  const fallbackMessage = 'Connexion Rapid Delivery impossible.'
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
      ? error.message
      : fallbackMessage
  const details = typeof error === 'object' && error !== null && 'details' in error && typeof error.details === 'string'
    ? error.details.trim()
    : ''
  const hint = typeof error === 'object' && error !== null && 'hint' in error && typeof error.hint === 'string'
    ? error.hint.trim()
    : ''

  if (message === 'MISSING_INTEGRATIONS_ENCRYPTION_KEY') {
    return 'Configuration serveur manquante: INTEGRATIONS_ENCRYPTION_KEY n’est pas défini.'
  }

  if (message === 'INVALID_INTEGRATIONS_ENCRYPTION_KEY') {
    return 'Configuration serveur invalide: INTEGRATIONS_ENCRYPTION_KEY doit être une clé base64 de 32 octets.'
  }

  if (details || hint) {
    return [message, details, hint].filter(Boolean).join(' | ')
  }

  return message
}

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      apiToken?: string
      mappings?: Array<{ externalShopId?: number; shopKey?: number; storeId?: string | null }>
    }
    const apiToken = String(body.apiToken || '').trim()

    if (!apiToken) return NextResponse.json({ error: 'Token API Rapid Delivery manquant.' }, { status: 400 })

    const [cities, shops, states] = await Promise.all([
      listRapidDeliveryCities(apiToken),
      listRapidDeliveryShops(apiToken),
      listRapidDeliveryStates(apiToken),
    ])

    const admin = createAdminClient()
    const providerId = await getRapidDeliveryProviderId(admin)
    const now = new Date().toISOString()
    const encryptedToken = encryptSecret(apiToken)

    const { data: existingIntegration, error: existingIntegrationError } = await admin
      .from('integrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'rapid-delivery')
      .maybeSingle()

    if (existingIntegrationError) throw existingIntegrationError

    const mappings: RapidDeliveryShopMappingInput[] = Array.isArray(body.mappings) && body.mappings.length > 0
      ? body.mappings.map((item) => ({
          externalShopId: Number(item.externalShopId ?? item.shopKey ?? 0),
          storeId: item.storeId ? String(item.storeId) : null,
        })).filter((item) => item.externalShopId > 0)
      : shops.map((shop) => ({ externalShopId: shop.key, storeId: null }))

    const mappedStoreIds = Array.from(new Set(mappings.map((item) => String(item.storeId || '').trim()).filter(Boolean)))
    const primaryStoreId = mappedStoreIds.length > 0 ? mappedStoreIds[0] : null

    let integrationId = String(existingIntegration?.id || '')
    if (integrationId) {
      const { error: updateIntegrationError } = await admin
        .from('integrations')
        .update({
          provider: 'rapid-delivery',
          provider_id: providerId,
          store_domain: 'www.rapiddelivery.ma',
          access_token: encryptedToken,
          status: 'connected',
          store_id: primaryStoreId,
          updated_at: now,
        })
        .eq('id', integrationId)
        .eq('user_id', user.id)

      if (updateIntegrationError) throw updateIntegrationError
    } else {
      const { data: createdIntegration, error: createIntegrationError } = await admin
        .from('integrations')
        .insert({
          user_id: user.id,
          provider: 'rapid-delivery',
          provider_id: providerId,
          store_domain: 'www.rapiddelivery.ma',
          access_token: encryptedToken,
          status: 'connected',
          store_id: primaryStoreId,
          updated_at: now,
        })
        .select('id')
        .single()

      if (createIntegrationError) throw createIntegrationError
      integrationId = String(createdIntegration.id)
    }

    const pricingResult = await syncPricingGroups({
      client: admin,
      providerId,
      integrationId,
      userId: user.id,
      cities,
    })

    await syncDeliveryShops({
      client: admin,
      integrationId,
      providerId,
      shops,
      mappings,
      pricingGroupId: pricingResult.pricingGroupId,
    })

    await syncDeliveryStates(admin, providerId, states)
    await syncLegacyRapidDeliveryData({
      client: admin,
      integrationId,
      userId: user.id,
      storeIds: mappedStoreIds,
      encryptedToken,
      shops,
      cities,
    })

    // Créer les delivery_companies pour chaque store mappé
    if (mappedStoreIds.length > 0) {
      const now = new Date().toISOString()
      for (const storeId of mappedStoreIds) {
        const { data: existing } = await admin
          .from('delivery_companies')
          .select('id')
          .eq('store_id', storeId)
          .eq('name', 'Rapid Delivery')
          .maybeSingle()

        if (existing) {
          const { error: updateError } = await admin
            .from('delivery_companies')
            .update({ is_active: true, updated_at: now })
            .eq('id', existing.id)
          if (updateError) console.error('Failed to update delivery_company for store', storeId, updateError)
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
          if (insertError) console.error('Failed to insert delivery_company for store', storeId, insertError)
        }
      }
    }

    return NextResponse.json({
      ok: true,
      integrationId,
      shops: shops.length,
      cities: cities.length,
      states: states.length,
      mappedStores: mappedStoreIds.length,
      pricingGroupType: pricingResult.isCustom ? 'custom' : 'default',
    })
  } catch (error) {
    const message = toRapidDeliveryErrorMessage(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}