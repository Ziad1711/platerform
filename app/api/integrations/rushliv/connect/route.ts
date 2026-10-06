import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser } from '@/lib/assistant/security'
import { listRushlivCities, validateRushlivToken } from '@/lib/integrations/rushliv'
import { encryptSecret } from '@/lib/security/crypto'
import {
  getRushlivProviderId,
  listUserStores,
  syncRushlivCities,
  syncRushlivConfigs,
} from '@/lib/integrations/rushliv-connect'

function toRushlivErrorMessage(error: unknown) {
  console.error('Rushliv connect error:', error)

  const fallbackMessage = 'Connexion Rushliv impossible.'
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
    const body = (await request.json().catch(() => ({}))) as { apiToken?: string; storeId?: string }
    const apiToken = String(body.apiToken || '').trim()

    if (!apiToken) return NextResponse.json({ error: 'Token API Rushliv manquant.' }, { status: 400 })

    // Les villes Rushliv sont publiques : on valide le token via `action=track`.
    await validateRushlivToken(apiToken)

    const cities = await listRushlivCities()

    const admin = createAdminClient()
    const providerId = await getRushlivProviderId(admin)
    const now = new Date().toISOString()
    const encryptedToken = encryptSecret(apiToken)

    const stores = await listUserStores(admin, user.id)
    const requestedStoreId = String(body.storeId || '').trim()

    // Le store demandé doit appartenir à l'utilisateur connecté, sinon on
    // rattacherait l'intégration à un store auquel il n'a pas accès.
    if (requestedStoreId && !stores.some((store) => String(store.id) === requestedStoreId)) {
      return NextResponse.json({ error: 'FORBIDDEN_STORE' }, { status: 403 })
    }

    const primaryStoreId = requestedStoreId || (stores[0]?.id ? String(stores[0].id) : '')

    const { data: existingIntegration, error: existingIntegrationError } = await admin
      .from('integrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'rushliv')
      .maybeSingle()

    if (existingIntegrationError) throw existingIntegrationError

    let integrationId = String(existingIntegration?.id || '')
    if (integrationId) {
      const { error: updateIntegrationError } = await admin
        .from('integrations')
        .update({
          provider: 'rushliv',
          provider_id: providerId,
          store_domain: 'clients.rushliv.com',
          access_token: encryptedToken,
          status: 'connected',
          store_id: primaryStoreId || null,
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
          provider: 'rushliv',
          provider_id: providerId,
          store_domain: 'clients.rushliv.com',
          access_token: encryptedToken,
          status: 'connected',
          store_id: primaryStoreId || null,
          updated_at: now,
        })
        .select('id')
        .single()

      if (createIntegrationError) throw createIntegrationError
      integrationId = String(createdIntegration.id)
    }

    const pricingResult = await syncRushlivCities({
      client: admin,
      providerId,
      integrationId,
      userId: user.id,
      cities,
    })

    if (primaryStoreId) {
      await syncRushlivConfigs({
        client: admin,
        integrationId,
        userId: user.id,
        storeId: primaryStoreId,
        encryptedToken,
      })

      const { data: existing } = await admin
        .from('delivery_companies')
        .select('id')
        .eq('store_id', primaryStoreId)
        .eq('name', 'Rushliv')
        .maybeSingle()

      if (existing) {
        await admin.from('delivery_companies').update({ is_active: true, updated_at: now }).eq('id', existing.id)
      } else {
        await admin.from('delivery_companies').insert({
          store_id: primaryStoreId,
          name: 'Rushliv',
          api_provider: 'rushliv',
          is_active: true,
          created_at: now,
        })
      }
    }

    return NextResponse.json({
      ok: true,
      integrationId,
      cities: cities.length,
      mappedStores: primaryStoreId ? 1 : 0,
      pricingGroupType: pricingResult.isCustom ? 'custom' : 'default',
    })
  } catch (error) {
    const message = toRushlivErrorMessage(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
