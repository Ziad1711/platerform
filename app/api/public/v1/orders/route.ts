import { NextRequest, NextResponse } from 'next/server'
import { requirePublicApiAuth } from '@/lib/integrations/custom-api/request-auth'
import { ingestOrder, IngestOrderPayload } from '@/lib/integrations/custom-api/ingest-order'
import { orderBodySchema, toValidationDetails } from '@/lib/integrations/custom-api/schemas'

export async function POST(request: NextRequest) {
  try {
    // 1. Authentifier via clé API + vérifier le périmètre d'écriture des commandes
    const { context, error } = await requirePublicApiAuth(request, 'orders:write')
    if (error) return error

    // 2. Valider le body (schéma strict)
    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Bad Request', code: 'INVALID_JSON', message: 'Corps JSON invalide' },
        { status: 400 }
      )
    }

    const parsed = orderBodySchema.safeParse(rawBody)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Payload invalide',
          details: toValidationDetails(parsed.error),
        },
        { status: 400 }
      )
    }

    // 3. Ingester la commande
    const result = await ingestOrder(
      context.storeId,
      context.apiKeyId,
      parsed.data as IngestOrderPayload
    )

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

      case 'rejected': {
        // Un conflit d'idempotence est un conflit de ressource, pas une erreur de données.
        const status = result.errorCode === 'IDEMPOTENCY_CONFLICT' ? 409 : 422
        return NextResponse.json(
          { status: 'rejected', error: result.errorCode, message: result.errorMessage },
          { status }
        )
      }
    }
  } catch (error) {
    console.error('[PUBLIC_API_ORDERS]', error)
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}
