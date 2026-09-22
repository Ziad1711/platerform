import { NextRequest, NextResponse } from 'next/server'
import { requirePublicApiAuth } from '@/lib/integrations/custom-api/request-auth'
import { getCatalogCategory } from '@/lib/integrations/custom-api/catalog'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ categoryId: string }> }
) {
  try {
    const { context, error } = await requirePublicApiAuth(request, 'products:read')
    if (error) return error

    const { categoryId } = await params
    const category = await getCatalogCategory(context.storeId, categoryId)

    if (!category) {
      return NextResponse.json(
        { error: 'Not Found', code: 'CATEGORY_NOT_FOUND', message: 'Catégorie introuvable pour ce store' },
        { status: 404 }
      )
    }

    return NextResponse.json({ data: category })
  } catch (error) {
    console.error('[PUBLIC_API_CATALOG_CATEGORY]', error)
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}
