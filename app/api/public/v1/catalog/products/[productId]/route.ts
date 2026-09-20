import { NextRequest, NextResponse } from 'next/server'
import { hasScope } from '@/lib/integrations/custom-api/auth'
import { requirePublicApiAuth } from '@/lib/integrations/custom-api/request-auth'
import { getCatalogProduct } from '@/lib/integrations/custom-api/catalog'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const { context, error } = await requirePublicApiAuth(request, 'products:read')
    if (error) return error

    const { productId } = await params
    const includeStock = hasScope(context.scopes, 'stock:read')

    const product = await getCatalogProduct({
      storeId: context.storeId,
      productId,
      includeStock,
    })

    if (!product) {
      return NextResponse.json(
        { error: 'Not Found', code: 'PRODUCT_NOT_FOUND', message: 'Produit introuvable pour ce store' },
        { status: 404 }
      )
    }

    return NextResponse.json({ data: product, includes_stock: includeStock })
  } catch (error) {
    console.error('[PUBLIC_API_CATALOG_PRODUCT]', error)
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}
