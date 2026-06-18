import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser } from '@/lib/assistant/security'
import { encryptSecret } from '@/lib/security/crypto'
import { validateForceLogApiKey } from '@/lib/integrations/forcelog'

const FORCELOG_PROVIDER_ID = '422b8621-f708-4e5a-ba50-c9196c214a8a'

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      apiKey?: string
      storeId?: string
      parcelCreationMode?: string
      defaultProductNature?: string
      defaultCanOpen?: boolean
      defaultFragile?: boolean
      defaultCarton?: string
      defaultStock?: string
      pickupPhone?: string
      pickupCityKey?: string
      pickupCityName?: string
      pickupCity?: string
      pickupAddress?: string
      pickupStickers?: boolean
    }

    const apiKey = String(body.apiKey || '').trim()
    const storeId = String(body.storeId || '').trim()

    if (!apiKey) return NextResponse.json({ error: 'API Key ForceLog manquante.' }, { status: 400 })
    if (!storeId) return NextResponse.json({ error: 'Veuillez sélectionner un store.' }, { status: 400 })

    // Fallback pour compatibilité ancien champ pickupCity
    const pickupCityKey = body.pickupCityKey || body.pickupCity || null
    const pickupCityName = body.pickupCityName || null
    const pickupPhone = body.pickupPhone || null
    const pickupAddress = body.pickupAddress || null

    if (!pickupPhone || !pickupCityKey || !pickupAddress) {
      return NextResponse.json({ error: 'FORCELOG_PICKUP_CONFIG_INCOMPLETE', message: 'Téléphone, ville et adresse de ramassage sont obligatoires.' }, { status: 400 })
    }

    // Vérifier accès store
    const admin = createAdminClient()
    const { data: membership, error: membershipError } = await admin
      .from('store_members')
      .select('store_id')
      .eq('user_id', user.id)
      .eq('store_id', storeId)
      .maybeSingle()

    if (membershipError) throw membershipError
    if (!membership) return NextResponse.json({ error: 'Accès refusé à ce store.' }, { status: 403 })

    // Valider la clé API
    const isValid = await validateForceLogApiKey(apiKey)
    if (!isValid) {
      return NextResponse.json({ error: 'API Key ForceLog invalide.' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const encryptedToken = encryptSecret(apiKey)

    // Vérifier si intégration existe déjà
    const { data: existingIntegration, error: existingError } = await admin
      .from('integrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'forcelog')
      .eq('store_id', storeId)
      .maybeSingle()

    if (existingError) throw existingError

    if (existingIntegration?.id) {
      const { error: updateError } = await admin
        .from('integrations')
        .update({
          provider_id: FORCELOG_PROVIDER_ID,
          access_token: encryptedToken,
          status: 'connected',
          updated_at: now,
        })
        .eq('id', existingIntegration.id)
        .eq('user_id', user.id)

      if (updateError) throw updateError
    } else {
      const { error: insertError } = await admin
        .from('integrations')
        .insert({
          user_id: user.id,
          provider: 'forcelog',
          provider_id: FORCELOG_PROVIDER_ID,
          access_token: encryptedToken,
          status: 'connected',
          store_id: storeId,
          updated_at: now,
        })

      if (insertError) throw insertError
    }

    // Récupérer l'ID de l'intégration pour la config
    const { data: integration } = await admin
      .from('integrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'forcelog')
      .eq('store_id', storeId)
      .maybeSingle()

    const integrationId = integration?.id

    // Créer/mettre à jour forcelog_configs
    if (integrationId) {
      await admin.from('forcelog_configs').upsert(
        {
          integration_id: integrationId,
          store_id: storeId,
          parcel_creation_mode: body.parcelCreationMode || 'auto',
          default_product_nature: body.defaultProductNature || null,
          default_can_open: body.defaultCanOpen !== undefined ? body.defaultCanOpen : true,
          default_fragile: body.defaultFragile !== undefined ? body.defaultFragile : false,
          default_carton: body.defaultCarton || null,
          default_stock: body.defaultStock || null,
          pickup_phone: pickupPhone,
          pickup_city_key: pickupCityKey,
          pickup_city_name: pickupCityName,
          pickup_address: pickupAddress,
          pickup_stickers: body.pickupStickers || false,
          updated_at: now,
        },
        { onConflict: 'store_id' }
      )
    }

    // Créer delivery_company
    const { data: existingCompany } = await admin
      .from('delivery_companies')
      .select('id')
      .eq('store_id', storeId)
      .eq('name', 'ForceLog')
      .maybeSingle()

    if (existingCompany?.id) {
      await admin
        .from('delivery_companies')
        .update({ is_active: true, updated_at: now })
        .eq('id', existingCompany.id)
    } else {
      await admin
        .from('delivery_companies')
        .insert({
          store_id: storeId,
          name: 'ForceLog',
          api_provider: 'forcelog',
          is_active: true,
          created_at: now,
        })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('ForceLog connect error:', error)
    const message = error instanceof Error ? error.message : 'Connexion ForceLog impossible.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}