import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'

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
      webhookUrl?: string
    }

    const { storeId, token } = body
    if (!storeId || !token) {
      return NextResponse.json({ error: 'MISSING_REQUIRED_FIELDS' }, { status: 400 })
    }

    await verifyStoreAccess(supabase, user.id, storeId)

    const admin = createAdminClient()

    // 1. Vérifier que le token est valide en appelant l'API Digylog
    const testRes = await fetch('https://api.digylog.com/api/v2/seller/cities', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Referer: 'https://apiseller.digylog.com',
      },
    })

    if (!testRes.ok) {
      const text = await testRes.text().catch(() => '')
      return NextResponse.json({ error: 'TOKEN_INVALID', detail: `HTTP ${testRes.status}: ${text.slice(0, 300)}` }, { status: 400 })
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
      default_network_id: body.defaultNetworkId || 1,
      default_order_mode: body.defaultOrderMode || 1,
      default_send_status: body.defaultSendStatus ?? 1,
      default_external_store: body.defaultExternalStore || null,
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

    // 4. Enregistrer le webhook automatiquement
    // L'URL du webhook pointe vers notre API
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || 'http://localhost:3000'
    const webhookUrl = `${baseUrl}/api/integrations/digylog/webhook`

    try {
      const whRes = await fetch('https://api.digylog.com/api/v2/seller/webhook', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Referer: 'https://apiseller.digylog.com',
        },
        body: JSON.stringify({ url: webhookUrl }),
      })
      if (!whRes.ok) {
        const whText = await whRes.text().catch(() => '')
        console.warn(`[digylog] webhook register returned ${whRes.status}: ${whText.slice(0, 200)}`)
      } else {
        console.log(`[digylog] webhook registered at ${webhookUrl}`)
      }
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
