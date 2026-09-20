import { NextRequest, NextResponse } from 'next/server'
import { hasScope } from '@/lib/integrations/custom-api/auth'
import { requirePublicApiAuth } from '@/lib/integrations/custom-api/request-auth'
import {
  DEFAULT_CATALOG_LIMIT,
  MAX_CATALOG_LIMIT,
  isValidUuid,
  listCatalogProducts,
} from '@/lib/integrations/custom-api/catalog'

function badRequest(code: string, message: string) {
  return NextResponse.json({ error: 'Bad Request', code, message }, { status: 400 })
}

export async function GET(request: NextRequest) {
  try {
    const { context, error } = await requirePublicApiAuth(request, 'products:read')
    if (error) return error

    const { searchParams } = new URL(request.url)

    // `limit`
    const limitParam = searchParams.get('limit')
    let limit = DEFAULT_CATALOG_LIMIT

    if (limitParam !== null && limitParam.trim() !== '') {
      const parsed = Number(limitParam)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_CATALOG_LIMIT) {
        return badRequest('INVALID_LIMIT', `limit doit être un entier entre 1 et ${MAX_CATALOG_LIMIT}`)
      }
      limit = parsed
    }

    // `cursor`
    const cursor = searchParams.get('cursor')
    if (cursor && !isValidUuid(cursor)) {
      return badRequest('INVALID_CURSOR', 'cursor doit être un identifiant produit Jisra (UUID)')
    }

    // `updated_since`
    const updatedSinceParam = searchParams.get('updated_since')
    let updatedSince: string | null = null

    if (updatedSinceParam && updatedSinceParam.trim() !== '') {
      const parsed = Date.parse(updatedSinceParam)
      if (Number.isNaN(parsed)) {
        return badRequest('INVALID_UPDATED_SINCE', 'updated_since doit être une date ISO 8601')
      }
      updatedSince = new Date(parsed).toISOString()
    }

    const sku = searchParams.get('sku')
    const includeStock = hasScope(context.scopes, 'stock:read')

    const result = await listCatalogProducts({
      storeId: context.storeId,
      limit,
      cursor,
      updatedSince,
      sku: sku ? sku.trim() : null,
      includeStock,
    })

    return NextResponse.json({
      data: result.products,
      currency: result.currency,
      includes_stock: includeStock,
      pagination: {
        limit,
        next_cursor: result.next_cursor,
        has_more: result.has_more,
      },
    })
  } catch (error) {
    console.error('[PUBLIC_API_CATALOG_PRODUCTS]', error)
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}
