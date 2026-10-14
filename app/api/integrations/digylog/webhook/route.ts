import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { processDigylogWebhook } from '@/lib/integrations/delivery/digylog-adapter'

/**
 * Webhook entrant Digylog
 *
 * Digylog envoie d'abord un PUT de vérification (subscribe),
 * puis les mises à jour de statut en POST.
 *
 * Handshake subscribe :
 *   PUT → { "type": "subscribe", "key": "<64-char hex>" }
 *   ← 200 { "key": "<same 64-char hex>" }
 */

export async function PUT(request: Request) {
  try {
    const body = await request.json()

    // Vérification d'abonnement Digylog
    if (body?.type === 'subscribe' && body?.key) {
      // Répondre avec la même clé pour valider l'abonnement
      return NextResponse.json({ key: body.key }, { status: 200 })
    }

    // Si ce n'est pas un subscribe, on traite comme un événement
    return handleEvent(body, request)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'WEBHOOK_PUT_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    return handleEvent(body, request)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'WEBHOOK_POST_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function handleEvent(body: any, request: Request) {
  const admin = createAdminClient()

  const eventType = body.event || body.type || body.event_type || 'order_status'
  const eventKey = body.id || body.event_id || body.key || null
  const payload = body.data || body.payload || body

  const tracking = String(payload?.tracking || payload?.traking || payload?.num || '').trim()
  if (!tracking) {
    return NextResponse.json({ ok: false, error: 'MISSING_TRACKING' }, { status: 400 })
  }

  // 1. Cible resolue par la DONNEE, jamais par les identifiants du payload :
  //    un appelant ne choisit ni le store ni l'integration.
  const { data: order } = await admin
    .from('orders')
    .select('store_id, delivery_company_id')
    .eq('tracking_number', tracking)
    .maybeSingle()

  if (!order?.store_id) {
    return NextResponse.json({ ok: false, error: 'ORDER_NOT_FOUND' }, { status: 404 })
  }

  const { data: integration } = await admin
    .from('integrations')
    .select('id')
    .eq('store_id', order.store_id)
    .eq('provider', 'digylog')
    .eq('status', 'connected')
    .maybeSingle()

  if (!integration?.id) {
    return NextResponse.json({ ok: false, error: 'INTEGRATION_NOT_CONNECTED' }, { status: 404 })
  }

  // 2. Authenticite : refus par defaut tant qu'aucun secret n'est configure
  //    (aucune ecriture sur un evenement non verifie).
  const { data: config } = await admin
    .from('digylog_configs')
    .select('webhook_secret')
    .eq('store_id', order.store_id)
    .maybeSingle()

  const expected = String(config?.webhook_secret || '').trim()
  if (!expected) {
    return NextResponse.json({ ok: false, error: 'WEBHOOK_NOT_CONFIGURED' }, { status: 503 })
  }

  const provided = String(request.headers.get('x-jisra-webhook-secret') || payload?.secret || '').trim()
  if (provided !== expected) {
    return NextResponse.json({ ok: false, error: 'INVALID_WEBHOOK_SECRET' }, { status: 401 })
  }

  const result = await processDigylogWebhook({
    admin,
    integrationId: integration.id,
    storeId: order.store_id,
    eventType,
    eventKey,
    payload,
  })

  return NextResponse.json(result)
}
