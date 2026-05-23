import { NextRequest, NextResponse } from 'next/server'
import { validateApiKey } from '@/lib/integrations/custom-api/auth'
import { ingestOrder, IngestOrderPayload } from '@/lib/integrations/custom-api/ingest-order'

export async function POST(request: NextRequest) {
  try {
    // 1. Authentifier via clé API
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'En-tête Authorization Bearer requis' },
        { status: 401 }
      )
    }

    const apiKey = authHeader.slice(7).trim()
    const { valid, storeId, apiKeyId, reason } = await validateApiKey(apiKey)

    if (!valid || !storeId) {
      const status = reason === 'INVALID_FORMAT' ? 400 : 401
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Clé API invalide ou révoquée', code: reason },
        { status }
      )
    }

    // 2. Valider le body
    let body: IngestOrderPayload
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Corps JSON invalide' },
        { status: 400 }
      )
    }

    if (!body.idempotency_key || !body.external_order_id || !body.customer_name || !body.items) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: 'Champs requis manquants : idempotency_key, external_order_id, customer_name, items',
        },
        { status: 400 }
      )
    }

    // 3. Ingester la commande
    const result = await ingestOrder(storeId, apiKeyId, body)

    switch (result.status) {
      case 'accepted':
        return NextResponse.json(
          { status: 'accepted', order_id: result.orderId },
          { status: 201 }
        )

      case 'duplicate':
        return NextResponse.json(
          { status: 'duplicate', order_id: result.orderId, message: 'Commande déjà importée' },
          { status: 200 }
        )

      case 'rejected':
        return NextResponse.json(
          { status: 'rejected', error: result.errorCode, message: result.errorMessage },
          { status: 422 }
        )
    }
  } catch (error) {
    console.error('[PUBLIC_API_ORDERS]', error)
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}
