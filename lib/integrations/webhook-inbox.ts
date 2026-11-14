import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { maintenanceEnabled } from '@/lib/maintenance/guard'

type Provider = 'youcan' | 'lightfunnels' | 'ameex' | 'digylog'
const replay = new AsyncLocalStorage<boolean>()
export function isWebhookReplay() { return replay.getStore() === true }

/** Called only after the original handler has authenticated and resolved its scope. */
export async function receiveWebhook(input: {
  provider: Provider; integrationId: string; request: Request; rawBody: string
  eventKey?: string; signature?: string | null
}) {
  if (isWebhookReplay()) return null
  const url = new URL(input.request.url)
  const key = input.eventKey || createHash('sha256').update(input.rawBody).digest('hex')
  if (!/^\/api\/integrations\/(youcan\/webhook\/order-create|lightfunnels\/webhook|ameex\/webhook|digylog\/webhook)$/.test(url.pathname)) {
    throw new Error('WEBHOOK_PATH_INVALID')
  }
  const admin = createAdminClient()
  const { error } = await admin.from('webhook_inbox').upsert({
    provider: input.provider, integration_id: input.integrationId, event_key: key,
    request_path: url.pathname + url.search, raw_body: input.rawBody,
    signature: input.signature || null,
    content_type: input.request.headers.get('content-type') || 'application/json',
  }, { onConflict: 'provider,integration_id,event_key', ignoreDuplicates: true })
  if (error) throw error
  // 202 acknowledges durable receipt, never successful business processing.
  return NextResponse.json({ ok: true, queued: true }, { status: 202 })
}

export async function drainWebhookInbox() {
  if (maintenanceEnabled()) return { paused: true, processed: 0, failed: 0 }
  const admin = createAdminClient()
  const start = Date.now()
  let processed = 0, failed = 0
  while (Date.now() - start < 40_000 && processed + failed < 20) {
    const { data, error } = await admin.rpc('rpc_webhook_inbox_claim')
    if (error) throw error
    const row = data?.[0]
    if (!row) break
    let failure: string | null = null
    try {
      const headers = new Headers({ 'content-type': row.content_type })
      if (row.provider === 'youcan') headers.set('x-youcan-signature', row.signature || '')
      if (row.provider === 'lightfunnels') headers.set('lightfunnels-hmac', row.signature || '')
      if (row.provider === 'ameex') headers.set(process.env.AMEEX_WEBHOOK_SIGNATURE_HEADER || 'x-ameex-signature', row.signature || '')
      if (row.provider === 'digylog') {
        const { data: integration, error: scopeError } = await admin.from('integrations')
          .select('store_id').eq('id', row.integration_id).single()
        if (scopeError) throw scopeError
        const { data: config, error: configError } = await admin.from('digylog_configs')
          .select('webhook_secret').eq('store_id', integration.store_id).single()
        if (configError || !config?.webhook_secret) throw new Error('WEBHOOK_CONFIG_UNAVAILABLE')
        headers.set('x-jisra-webhook-secret', config.webhook_secret)
      }
      const request = new Request('http://webhook.internal' + row.request_path, {
        method: 'POST', headers, body: row.raw_body,
      })
      const response = await replay.run(true, async () => {
        switch (row.provider as Provider) {
          case 'youcan': return (await import('@/app/api/integrations/youcan/webhook/order-create/route')).POST(request)
          case 'lightfunnels': return (await import('@/app/api/integrations/lightfunnels/webhook/route')).POST(request)
          case 'ameex': return (await import('@/app/api/integrations/ameex/webhook/route')).POST(request)
          case 'digylog': return (await import('@/app/api/integrations/digylog/webhook/route')).POST(request)
        }
      })
      if (!response) throw new Error('WEBHOOK_PROVIDER_INVALID')
      const body = await response.json()
      if (!response.ok || response.status === 202 || body.ok === false || body.queued) {
        throw new Error('WEBHOOK_PROCESSING_UNCONFIRMED_' + response.status)
      }
      processed++
    } catch {
      // Do not persist raw errors or provider credentials in diagnostics.
      failure = 'WEBHOOK_PROCESSING_FAILED'
      failed++
    }
    const { data: finished, error: finishError } = await admin.rpc('rpc_webhook_inbox_finish', {
      p_id: row.id, p_token: row.lease_token, p_error: failure,
    })
    if (finishError || !finished) throw new Error('WEBHOOK_LEASE_FINISH_FAILED')
  }
  return { paused: false, processed, failed }
}