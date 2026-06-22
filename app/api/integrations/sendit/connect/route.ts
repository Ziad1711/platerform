import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser } from '@/lib/assistant/security'
import { encryptSecret } from '@/lib/security/crypto'
import { loginSendit } from '@/lib/integrations/sendit'

const SENDIT_PROVIDER_ID = '5998e563-96ed-47cc-881a-43f41827f858'

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      publicKey?: string
      secretKey?: string
      storeId?: string
      pickupDistrictId?: string
    }

    const publicKey = String(body.publicKey || '').trim()
    const secretKey = String(body.secretKey || '').trim()
    const storeId = String(body.storeId || '').trim()
    const pickupDistrictId = String(body.pickupDistrictId || '').trim() || null

    if (!storeId) return NextResponse.json({ error: 'Veuillez sélectionner un store.' }, { status: 400 })

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

    const now = new Date().toISOString()

    // Si publicKey === '__skip__', on ne fait que mettre à jour la config (pickupDistrictId)
    const isConfigOnlyUpdate = publicKey === '__skip__' && secretKey === '__skip__'

    if (isConfigOnlyUpdate) {
      // Mettre à jour uniquement sendit_configs
      const { data: integration } = await admin
        .from('integrations')
        .select('id')
        .eq('user_id', user.id)
        .eq('provider', 'sendit')
        .eq('store_id', storeId)
        .maybeSingle()

      if (!integration?.id) {
        return NextResponse.json({ error: 'Intégration Sendit introuvable.' }, { status: 404 })
      }

      const configPayload: Record<string, any> = {
        integration_id: integration.id,
        store_id: storeId,
        updated_at: now,
      }
      if (pickupDistrictId) {
        configPayload.default_pickup_district_id = pickupDistrictId
      }
      await admin.from('sendit_configs').upsert(configPayload, { onConflict: 'store_id' })

      return NextResponse.json({ ok: true })
    }

    if (!publicKey) return NextResponse.json({ error: 'Clé publique Sendit manquante.' }, { status: 400 })
    if (!secretKey) return NextResponse.json({ error: 'Clé secrète Sendit manquante.' }, { status: 400 })

    // Valider les credentials Sendit
    const loginResult = await loginSendit(publicKey, secretKey)
    const token = String(loginResult?.data?.token || '').trim()
    if (!token) return NextResponse.json({ error: 'Credentials Sendit invalides.' }, { status: 400 })

    const encryptedToken = encryptSecret(JSON.stringify({ publicKey, secretKey, token }))

    // Vérifier si intégration existe déjà
    const { data: existingIntegration, error: existingError } = await admin
      .from('integrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'sendit')
      .eq('store_id', storeId)
      .maybeSingle()

    if (existingError) throw existingError

    if (existingIntegration?.id) {
      const { error: updateError } = await admin
        .from('integrations')
        .update({
          provider_id: SENDIT_PROVIDER_ID,
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
          provider: 'sendit',
          provider_id: SENDIT_PROVIDER_ID,
          access_token: encryptedToken,
          status: 'connected',
          store_id: storeId,
          updated_at: now,
        })

      if (insertError) throw insertError
    }

    // Récupérer l'ID de l'intégration
    const { data: integration } = await admin
      .from('integrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'sendit')
      .eq('store_id', storeId)
      .maybeSingle()

    const integrationId = integration?.id

    // Créer/mettre à jour sendit_configs
    if (integrationId) {
      const configPayload: Record<string, any> = {
        integration_id: integrationId,
        store_id: storeId,
        updated_at: now,
      }
      if (pickupDistrictId) {
        configPayload.default_pickup_district_id = pickupDistrictId
      }
      await admin.from('sendit_configs').upsert(configPayload, { onConflict: 'store_id' })
    }

    // Créer delivery_company
    const { data: existingCompany } = await admin
      .from('delivery_companies')
      .select('id')
      .eq('store_id', storeId)
      .eq('name', 'Sendit')
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
          name: 'Sendit',
          api_provider: 'sendit',
          is_active: true,
          created_at: now,
        })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Sendit connect error:', error)
    const message = error instanceof Error ? error.message : 'Connexion Sendit impossible.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
