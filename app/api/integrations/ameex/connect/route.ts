import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser } from '@/lib/assistant/security'
import { encryptSecret } from '@/lib/security/crypto'
import { validateAmeexCredentials } from '@/lib/integrations/ameex'

const AMEEX_PROVIDER_ID = '729e93ed-207f-4281-8ef6-de37006993de'

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      apiId?: string
      apiKey?: string
      storeId?: string
      businessId?: string
      parcelCreationMode?: string
      defaultOpen?: boolean
      defaultFragile?: boolean
      defaultReplace?: boolean
      defaultParcelType?: string
      pickupPhone?: string
      pickupCityKey?: string
      pickupCityName?: string
      pickupAddress?: string
    }

    const apiId = String(body.apiId || '').trim()
    const apiKey = String(body.apiKey || '').trim()
    const storeId = String(body.storeId || '').trim()
    const businessId = String(body.businessId || apiId).trim()

    if (!apiId) return NextResponse.json({ error: 'API ID AMEEX manquant.' }, { status: 400 })
    if (!apiKey) return NextResponse.json({ error: 'API KEY AMEEX manquante.' }, { status: 400 })
    if (!storeId) return NextResponse.json({ error: 'Veuillez selectionner un store.' }, { status: 400 })

    // Verifier acces store
    const admin = createAdminClient()
    const { data: membership, error: membershipError } = await admin
      .from('store_members')
      .select('store_id')
      .eq('user_id', user.id)
      .eq('store_id', storeId)
      .maybeSingle()

    if (membershipError) throw membershipError
    if (!membership) return NextResponse.json({ error: 'Acces refuse a ce store.' }, { status: 403 })

    // Valider les credentials
    const isValid = await validateAmeexCredentials(apiId, apiKey)
    if (!isValid) {
      return NextResponse.json({ error: 'Credentials AMEEX invalides.' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const encryptedKey = encryptSecret(apiKey)

    // Verifier si integration existe
    const { data: existingIntegration, error: existingError } = await admin
      .from('integrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'ameex')
      .eq('store_id', storeId)
      .maybeSingle()

    if (existingError) throw existingError

    const tokenPayload = JSON.stringify({ apiId, apiKey: encryptedKey })
    const encryptedPayload = encryptSecret(tokenPayload)

    if (existingIntegration?.id) {
      const { error: updateError } = await admin
        .from('integrations')
        .update({
          provider_id: AMEEX_PROVIDER_ID,
          access_token: encryptedPayload,
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
          provider: 'ameex',
          provider_id: AMEEX_PROVIDER_ID,
          access_token: encryptedPayload,
          status: 'connected',
          store_id: storeId,
          updated_at: now,
        })

      if (insertError) throw insertError
    }

    // Recuperer l'ID de l'integration
    const { data: integration } = await admin
      .from('integrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'ameex')
      .eq('store_id', storeId)
      .maybeSingle()

    const integrationId = integration?.id

    // Creer/mettre a jour ameex_configs
    if (integrationId) {
      await admin.from('ameex_configs').upsert(
        {
          integration_id: integrationId,
          store_id: storeId,
          business_id: businessId,
          parcel_creation_mode: body.parcelCreationMode || 'auto',
          default_open: body.defaultOpen !== undefined ? body.defaultOpen : true,
          default_fragile: body.defaultFragile !== undefined ? body.defaultFragile : false,
          default_replace: body.defaultReplace !== undefined ? body.defaultReplace : true,
          default_parcel_type: body.defaultParcelType || 'SIMPLE',
          pickup_phone: body.pickupPhone || null,
          pickup_city_key: body.pickupCityKey || null,
          pickup_city_name: body.pickupCityName || null,
          pickup_address: body.pickupAddress || null,
          updated_at: now,
        },
        { onConflict: 'store_id' }
      )
    }

    // Creer delivery_company
    const { data: existingCompany } = await admin
      .from('delivery_companies')
      .select('id')
      .eq('store_id', storeId)
      .eq('name', 'Ameex')
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
          name: 'Ameex',
          api_provider: 'ameex',
          is_active: true,
          created_at: now,
        })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('AMEEX connect error:', error)
    const message = error instanceof Error ? error.message : 'Connexion AMEEX impossible.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}