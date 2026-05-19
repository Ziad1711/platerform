import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyYouCanWebhookSignature } from '@/lib/integrations/youcan'
import { upsertYouCanOrderFromPayload } from '@/lib/integrations/youcan-sync'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const integrationId = (url.searchParams.get('integration_id') || '').trim()

  console.info('[youcan][webhook][order.create] probe', {
    method: 'GET',
    integrationId: integrationId || null,
    path: url.pathname,
  })

  return NextResponse.json({
    ok: true,
    route: 'youcan order.create webhook',
    integrationId: integrationId || null,
  })
}

export async function POST(request: Request) {
  try {
    const requestId = `youcan_wh_${Date.now()}`
    const url = new URL(request.url)
    const integrationId = (url.searchParams.get('integration_id') || '').trim()

    console.info('[youcan][webhook][order.create] incoming request', {
      requestId,
      method: request.method,
      path: url.pathname,
      integrationId: integrationId || null,
      hasSignature: Boolean((request.headers.get('x-youcan-signature') || '').trim()),
      userAgent: request.headers.get('user-agent') || null,
      contentType: request.headers.get('content-type') || null,
    })

    if (!integrationId) {
      console.warn('[youcan][webhook][order.create] missing integration_id', { requestId })
      return NextResponse.json({ error: 'MISSING_INTEGRATION_ID' }, { status: 400 })
    }

    const signature = (request.headers.get('x-youcan-signature') || '').trim()
    if (!signature) {
      console.warn('[youcan][webhook][order.create] missing signature', {
        requestId,
        integrationId,
      })
      return NextResponse.json({ error: 'MISSING_SIGNATURE' }, { status: 401 })
    }

    const rawBody = await request.text()
    const clientSecret = (process.env.YOUCAN_CLIENT_SECRET || '').trim()
    if (!clientSecret) {
      console.error('[youcan][webhook][order.create] missing youcan config', {
        requestId,
        integrationId,
      })
      return NextResponse.json({ error: 'MISSING_YOUCAN_CONFIG' }, { status: 500 })
    }

    const isValid = verifyYouCanWebhookSignature({
      signature,
      rawBody,
      clientSecret,
    })

    if (!isValid) {
      console.warn('[youcan][webhook][order.create] invalid signature', {
        requestId,
        integrationId,
        signaturePrefix: signature.slice(0, 12),
        bodyLength: rawBody.length,
      })
      return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 401 })
    }

    const payload = JSON.parse(rawBody || '{}')
    const youcanEventId = payload?.id ? String(payload.id) : null

    console.info('[youcan][webhook][order.create] payload parsed', {
      requestId,
      integrationId,
      youcanEventId,
      bodyLength: rawBody.length,
    })

    const supabase = createAdminClient()

    const { data: integration, error: integrationError } = await supabase
      .from('integrations')
      .select('id, user_id, store_domain')
      .eq('id', integrationId)
      .eq('provider', 'youcan')
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration) {
      console.warn('[youcan][webhook][order.create] integration not found', {
        requestId,
        integrationId,
      })
      return NextResponse.json({ error: 'INTEGRATION_NOT_FOUND' }, { status: 404 })
    }

    const { data: cfg } = await supabase
      .from('youcan_integration_configs')
      .select('store_id')
      .eq('integration_id', integration.id)
      .maybeSingle()

    let resolvedStoreId = cfg?.store_id || null

    if (!resolvedStoreId) {
      const normalizedStoreSlug = String(integration.store_domain || '')
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\.youcan\.shop$/, '')
        .replace(/\/$/, '')

      const { data: memberStores, error: memberStoresError } = await supabase
        .from('store_members')
        .select('store_id, stores(name)')
        .eq('user_id', integration.user_id)
        .eq('status', 'active')

      if (memberStoresError) throw memberStoresError

      const ownedStores = (memberStores || []).map((m: any) => ({
        id: m.store_id,
        name: m.stores?.name || null
      }))

      const matchedStore = ownedStores.find((store: { id: string; name: string | null }) => {
        const normalizedName = String(store.name || '').trim().toLowerCase()
        return normalizedName.length > 0 && normalizedName === normalizedStoreSlug
      })

      if (matchedStore?.id) {
        resolvedStoreId = matchedStore.id

        await supabase.from('youcan_integration_configs').upsert(
          {
            integration_id: integration.id,
            user_id: integration.user_id,
            store_id: resolvedStoreId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'integration_id' }
        )

        console.info('[youcan][webhook][order.create] store mapping auto-created from store_domain', {
          requestId,
          integrationId,
          resolvedStoreId,
          normalizedStoreSlug,
        })
      } else if ((ownedStores || []).length === 1) {
        resolvedStoreId = ownedStores?.[0]?.id || null

        await supabase.from('youcan_integration_configs').upsert(
          {
            integration_id: integration.id,
            user_id: integration.user_id,
            store_id: resolvedStoreId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'integration_id' }
        )

        console.info('[youcan][webhook][order.create] store mapping auto-created from single owned store', {
          requestId,
          integrationId,
          resolvedStoreId,
        })
      }
    }

    if (!resolvedStoreId) {
      console.warn('[youcan][webhook][order.create] missing store mapping', {
        requestId,
        integrationId,
        storeDomain: integration.store_domain || null,
      })
      return NextResponse.json({ error: 'MISSING_STORE_MAPPING' }, { status: 400 })
    }

    const { data: insertedEvent, error: eventError } = await supabase
      .from('youcan_webhook_events')
      .upsert(
        {
          integration_id: integration.id,
          event_type: 'order.create',
          youcan_event_id: youcanEventId,
          payload,
          signature,
          processed: false,
          error: null,
        },
        { onConflict: 'integration_id,event_type,youcan_event_id' }
      )
      .select('id')
      .single()

    if (eventError) throw eventError

    try {
      await upsertYouCanOrderFromPayload({
        supabase,
        integrationId: integration.id,
        userId: integration.user_id,
        storeId: resolvedStoreId,
        order: payload,
      })

      await supabase
        .from('youcan_webhook_events')
        .update({ processed: true, error: null })
        .eq('id', insertedEvent.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'WEBHOOK_PROCESSING_FAILED'
      await supabase
        .from('youcan_webhook_events')
        .update({ processed: false, error: message })
        .eq('id', insertedEvent.id)
      throw error
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'YOUCAN_WEBHOOK_FAILED'
    console.error('[youcan][webhook][order.create] failed', { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
