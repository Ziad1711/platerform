import { NextRequest, NextResponse } from 'next/server'
import { requirePublicApiAuth } from '@/lib/integrations/custom-api/request-auth'
import { listCatalogCategories } from '@/lib/integrations/custom-api/catalog'

export async function GET(request: NextRequest) {
  try {
    const { context, error } = await requirePublicApiAuth(request, 'products:read')
    if (error) return error

    const data = await listCatalogCategories(context.storeId)

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[PUBLIC_API_CATALOG_CATEGORIES]', error)
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}
