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

  // Extraire les infos du webhook
  const eventType = body.event || body.type || body.event_type || 'order_status'
  const eventKey = body.id || body.event_id || body.key || null
  const payload = body.data || body.payload || body

  // Déterminer le store_id et integration_id
  const storeId = body.store_id || payload?.store_id || request.headers.get('x-store-id') || ''
  const integrationId = body.integration_id || payload?.integration_id || request.headers.get('x-integration-id') || ''

  if (!storeId || !integrationId) {
    // Fallback: chercher l'intégration Digylog via le tracking
    const tracking = payload?.tracking || payload?.num || ''
    if (tracking) {
      const { data: order } = await admin
        .from('orders')
        .select('store_id, delivery_company_id')
        .eq('tracking_number', tracking)
        .maybeSingle()

      if (order?.store_id) {
        const { data: integration } = await admin
          .from('integrations')
          .select('id')
          .eq('store_id', order.store_id)
          .eq('provider', 'digylog')
          .eq('status', 'connected')
          .maybeSingle()

        if (integration?.id) {
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
      }
    }

    return NextResponse.json({ ok: false, error: 'MISSING_STORE_OR_INTEGRATION' }, { status: 400 })
  }

  const result = await processDigylogWebhook({
    admin,
    integrationId,
    storeId,
    eventType,
    eventKey,
    payload,
  })

  return NextResponse.json(result)
}
