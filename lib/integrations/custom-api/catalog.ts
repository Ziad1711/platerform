import { createAdminClient } from '@/lib/supabase/admin'
import { computeStoreStock, getStoreCurrency } from './catalog-stock'
import { buildCatalogProducts } from './catalog-mapper'
import {
  ACTIVE_PUBLICATION_STATUS,
  PRODUCT_COLUMNS,
  VARIANT_COLUMNS,
  isValidUuid,
  type CatalogProduct,
  type ProductRow,
  type VariantRow,
} from './catalog-shared'

export {
  DEFAULT_CATALOG_LIMIT,
  MAX_CATALOG_LIMIT,
  ACTIVE_PUBLICATION_STATUS,
  clampCatalogLimit,
  isValidUuid,
} from './catalog-shared'

export type { CatalogProduct, CatalogVariant } from './catalog-shared'

export async function fetchCatalogVariants(productIds: string[]): Promise<VariantRow[]> {
  const ids = Array.from(new Set(productIds.map((id) => String(id || '')).filter(Boolean)))
  if (ids.length === 0) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_variants')
    .select(VARIANT_COLUMNS)
    .in('product_id', ids)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data || []) as VariantRow[]
}

/**
 * Liste paginée (keyset sur `id`) du catalogue publié d'un store.
 * `updated_since` permet une synchronisation incrémentale côté site.
 */
export async function listCatalogProducts(params: {
  storeId: string
  limit: number
  cursor: string | null
  updatedSince: string | null
  sku: string | null
  includeStock: boolean
}): Promise<{
  products: CatalogProduct[]
  next_cursor: string | null
  has_more: boolean
  currency: string
}> {
  const supabase = createAdminClient()

  let query = supabase
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('store_id', params.storeId)
    .eq('publication_status', ACTIVE_PUBLICATION_STATUS)
    .order('id', { ascending: true })
    .limit(params.limit + 1)

  if (params.cursor && isValidUuid(params.cursor)) {
    query = query.gt('id', params.cursor)
  }

  if (params.updatedSince) {
    query = query.gt('updated_at', params.updatedSince)
  }

  if (params.sku) {
    query = query.eq('sku', params.sku)
  }

  const { data, error } = await query
  if (error) throw error

  const rows = (data || []) as ProductRow[]
  const hasMore = rows.length > params.limit
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows

  const currency = await getStoreCurrency(params.storeId)
  const variants = await fetchCatalogVariants(pageRows.map((row) => String(row.id)))

  let productStock: Record<string, number> = {}
  let variantStock: Record<string, number> = {}

  if (params.includeStock) {
    const snapshot = await computeStoreStock(
      params.storeId,
      pageRows.map((row) => String(row.id))
    )
    productStock = snapshot.productStock
    variantStock = snapshot.variantStock
  }

  const products = buildCatalogProducts({
    products: pageRows,
    variants,
    productStock,
    variantStock,
    currency,
    includeStock: params.includeStock,
  })

  return {
    products,
    next_cursor: hasMore && pageRows.length > 0 ? String(pageRows[pageRows.length - 1].id) : null,
    has_more: hasMore,
    currency,
  }
}

/** Renvoie le produit publié demandé, ou `null` s'il est introuvable, non publié ou hors store. */
export async function getCatalogProduct(params: {
  storeId: string
  productId: string
  includeStock: boolean
}): Promise<CatalogProduct | null> {
  if (!isValidUuid(params.productId)) return null

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('store_id', params.storeId)
    .eq('publication_status', ACTIVE_PUBLICATION_STATUS)
    .eq('id', params.productId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const product = data as ProductRow
  const currency = await getStoreCurrency(params.storeId)
  const variants = await fetchCatalogVariants([String(product.id)])

  let productStock: Record<string, number> = {}
  let variantStock: Record<string, number> = {}

  if (params.includeStock) {
    const snapshot = await computeStoreStock(params.storeId, [String(product.id)])
    productStock = snapshot.productStock
    variantStock = snapshot.variantStock
  }

  const [catalogProduct] = buildCatalogProducts({
    products: [product],
    variants,
    productStock,
    variantStock,
    currency,
    includeStock: params.includeStock,
  })

  return catalogProduct || null
}
