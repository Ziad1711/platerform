import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { getStores, registerWebhook } from '@/lib/integrations/digylog'

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json()) as {
      storeId: string
      token: string
      defaultNetworkId?: number
      defaultOrderMode?: number
      defaultSendStatus?: number
      defaultExternalStore?: string
      defaultPort?: number
      webhookUrl?: string
      validateOnly?: boolean
    }

    const { storeId, token } = body
    if (!storeId || !token) {
      return NextResponse.json({ error: 'MISSING_REQUIRED_FIELDS' }, { status: 400 })
    }

    await verifyStoreAccess(supabase, user.id, storeId)

    const admin = createAdminClient()

    // 1. Vérifier le token + récupérer les stores Digylog
    let digylogStores: any[] = []
    try {
      const storesPayload = await getStores({ token, referer: 'https://apiseller.digylog.com' })
      digylogStores = Array.isArray(storesPayload)
        ? storesPayload
        : Array.isArray(storesPayload?.data)
          ? storesPayload.data
          : Array.isArray(storesPayload?.stores)
            ? storesPayload.stores
            : []
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return NextResponse.json({ error: 'TOKEN_INVALID', detail: detail.slice(0, 300) }, { status: 400 })
    }

    if (body.validateOnly) {
      return NextResponse.json({ ok: true, stores: digylogStores })
    }

    // 2. Créer/mettre à jour l'intégration
    const { data: existingIntegration } = await supabase
      .from('integrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'digylog')
      .eq('store_id', storeId)
      .maybeSingle()

    let integrationId: string

    const DIGYLOG_PROVIDER_ID = 'eeeb5b4f-741b-4d53-b4dd-72a7bd26f9cf'

    if (existingIntegration?.id) {
      const { error: updateError } = await supabase
        .from('integrations')
        .update({
          access_token: token,
          status: 'connected',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingIntegration.id)

      if (updateError) throw updateError
      integrationId = existingIntegration.id
    } else {
      const { data: newIntegration, error: insertError } = await supabase
        .from('integrations')
        .insert({
          user_id: user.id,
          store_id: storeId,
          provider: 'digylog',
          provider_id: DIGYLOG_PROVIDER_ID,
          access_token: token,
          status: 'connected',
        })
        .select('id')
        .single()

      if (insertError) throw insertError
      integrationId = newIntegration.id
    }

    // 3. Créer/mettre à jour la config Digylog
    const configData: Record<string, any> = {
      integration_id: integrationId,
      store_id: storeId,
      default_network_id: body.defaultNetworkId || 2,
      default_order_mode: body.defaultOrderMode || 1,
      default_send_status: body.defaultSendStatus ?? 1,
      default_external_store: body.defaultExternalStore || null,
      port_default: body.defaultPort || 2,
      updated_at: new Date().toISOString(),
    }

    const { data: existingConfig } = await supabase
      .from('digylog_configs')
      .select('id')
      .eq('store_id', storeId)
      .maybeSingle()

    if (existingConfig?.id) {
      await supabase.from('digylog_configs').update(configData).eq('id', existingConfig.id)
    } else {
      configData.created_at = new Date().toISOString()
      await supabase.from('digylog_configs').insert(configData)
    }

    const { data: existingCompany } = await admin
      .from('delivery_companies')
      .select('id')
      .eq('store_id', storeId)
      .eq('name', 'Digylog')
      .maybeSingle()

    if (existingCompany?.id) {
      await admin
        .from('delivery_companies')
        .update({ api_provider: 'digylog', is_active: true })
        .eq('id', existingCompany.id)
    } else {
      await admin
        .from('delivery_companies')
        .insert({
          store_id: storeId,
          name: 'Digylog',
          api_provider: 'digylog',
          is_active: true,
          created_at: new Date().toISOString(),
        })
    }

    // 4. Enregistrer le webhook automatiquement
    // L'URL du webhook pointe vers notre API
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || 'http://localhost:3000'
    const webhookUrl = `${baseUrl}/api/integrations/digylog/webhook`

    try {
      await registerWebhook({ token, referer: 'https://apiseller.digylog.com' }, body.webhookUrl || webhookUrl)
      console.log(`[digylog] webhook registered at ${body.webhookUrl || webhookUrl}`)
    } catch (e) {
      console.warn('[digylog] webhook register fetch failed', e)
    }

    return NextResponse.json({ ok: true, integrationId })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : ''
    const detail = stack?.slice(0, 500) || (typeof error === 'object' && error !== null ? JSON.stringify(error) : String(error)).slice(0, 500)
    console.error('[digylog] connect error:', message, detail)
    return NextResponse.json({ error: message, detail }, { status: 500 })
  }
}
