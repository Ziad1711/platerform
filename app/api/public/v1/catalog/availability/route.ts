import { NextRequest, NextResponse } from 'next/server'
import { hasScope } from '@/lib/integrations/custom-api/auth'
import { requirePublicApiAuth } from '@/lib/integrations/custom-api/request-auth'
import { checkItemsAvailability } from '@/lib/integrations/custom-api/catalog-availability'
import { availabilityBodySchema, toValidationDetails } from '@/lib/integrations/custom-api/schemas'

export async function POST(request: NextRequest) {
  try {
    const { context, error } = await requirePublicApiAuth(request, 'products:read')
    if (error) return error

    if (!hasScope(context.scopes, 'stock:read')) {
      return NextResponse.json(
        {
          error: 'Forbidden',
          code: 'MISSING_SCOPE',
          message: 'Cette clé API ne possède pas le périmètre requis : stock:read',
        },
        { status: 403 }
      )
    }

    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Bad Request', code: 'INVALID_JSON', message: 'Corps JSON invalide' },
        { status: 400 }
      )
    }

    const parsed = availabilityBodySchema.safeParse(rawBody)

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

    const result = await checkItemsAvailability(context.storeId, parsed.data.items)

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    console.error('[PUBLIC_API_CATALOG_AVAILABILITY]', error)
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}
