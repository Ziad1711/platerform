import { createAdminClient } from '@/lib/supabase/admin'
import { computeStoreStock, getStoreCurrency } from './catalog-stock'
import { buildCatalogProducts } from './catalog-mapper'
import {
  ACTIVE_PUBLICATION_STATUS,
  CATEGORY_COLUMNS,
  IMAGE_COLUMNS,
  PRODUCT_COLUMNS,
  VARIANT_COLUMNS,
  isValidUuid,
  resolvePublicImageUrl,
  type CatalogProduct,
  type CategoryRow,
  type ProductImageRow,
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

/** Toutes les images (galerie produit + images de variantes) en une seule requête. */
export async function fetchCatalogImages(productIds: string[]): Promise<ProductImageRow[]> {
  const ids = Array.from(new Set(productIds.map((id) => String(id || '')).filter(Boolean)))
  if (ids.length === 0) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_images')
    .select(IMAGE_COLUMNS)
    .in('product_id', ids)
    .order('sort_order', { ascending: true })

  if (error) throw error
  return (data || []) as ProductImageRow[]
}

/** Catégories référencées par les produits d'une page (évite toute requête par produit du store). */
export async function fetchCatalogCategories(
  storeId: string,
  categoryIds: Array<string | null | undefined>
): Promise<Map<string, CategoryRow>> {
  const ids = Array.from(
    new Set(categoryIds.map((id) => String(id || '')).filter((id) => isValidUuid(id)))
  )

  const result = new Map<string, CategoryRow>()
  if (ids.length === 0) return result

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_categories')
    .select(CATEGORY_COLUMNS)
    .eq('store_id', storeId)
    .in('id', ids)

  if (error) throw error

  for (const row of (data || []) as CategoryRow[]) {
    result.set(String(row.id), row)
  }

  return result
}

/** Catégories publiées du store, triées par `sort_order` puis nom. */
export async function listCatalogCategories(storeId: string): Promise<
  Array<{
    id: string
    name: string
    slug: string
    description: string | null
    image_url: string | null
    sort_order: number
  }>
> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_categories')
    .select(CATEGORY_COLUMNS)
    .eq('store_id', storeId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) throw error

  return ((data || []) as CategoryRow[]).map((row) => ({
    id: String(row.id),
    name: String(row.name || ''),
    slug: String(row.slug || ''),
    description: row.description ? String(row.description) : null,
    image_url: resolvePublicImageUrl(row.image_url),
    sort_order: Number(row.sort_order || 0),
  }))
}

/** Catégorie unique du store, ou `null` si introuvable. */
export async function getCatalogCategory(
  storeId: string,
  categoryId: string
): Promise<{
  id: string
  name: string
  slug: string
  description: string | null
  image_url: string | null
  sort_order: number
} | null> {
  if (!isValidUuid(categoryId)) return null

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_categories')
    .select(CATEGORY_COLUMNS)
    .eq('store_id', storeId)
    .eq('id', categoryId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as CategoryRow

  return {
    id: String(row.id),
    name: String(row.name || ''),
    slug: String(row.slug || ''),
    description: row.description ? String(row.description) : null,
    image_url: resolvePublicImageUrl(row.image_url),
    sort_order: Number(row.sort_order || 0),
  }
}

/** Résout un slug de catégorie en identifiant, `null` si la catégorie n'existe pas dans ce store. */
export async function resolveCategoryIdBySlug(storeId: string, slug: string): Promise<string | null> {
  const clean = String(slug || '').trim()
  if (!clean) return null

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_categories')
    .select('id')
    .eq('store_id', storeId)
    .eq('slug', clean)
    .maybeSingle()

  if (error) throw error
  return data?.id ? String(data.id) : null
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
  slug: string | null
  categoryId: string | null
  categorySlug: string | null
  includeStock: boolean
}): Promise<{
  products: CatalogProduct[]
  next_cursor: string | null
  has_more: boolean
  currency: string
}> {
  const supabase = createAdminClient()

  let categoryIdFilter = params.categoryId && isValidUuid(params.categoryId) ? params.categoryId : null

  if (!categoryIdFilter && params.categorySlug) {
    categoryIdFilter = await resolveCategoryIdBySlug(params.storeId, params.categorySlug)

    // Catégorie inconnue dans ce store : aucun produit ne peut correspondre.
    if (!categoryIdFilter) {
      const currency = await getStoreCurrency(params.storeId)
      return { products: [], next_cursor: null, has_more: false, currency }
    }
  }

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

  if (params.slug) {
    query = query.eq('slug', params.slug)
  }

  if (categoryIdFilter) {
    query = query.eq('category_id', categoryIdFilter)
  }

  const { data, error } = await query
  if (error) throw error

  const rows = (data || []) as ProductRow[]
  const hasMore = rows.length > params.limit
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows
  const productIds = pageRows.map((row) => String(row.id))

  const currency = await getStoreCurrency(params.storeId)
  const [variants, images] = await Promise.all([
    fetchCatalogVariants(productIds),
    fetchCatalogImages(productIds),
  ])
  const categories = await fetchCatalogCategories(
    params.storeId,
    pageRows.map((row) => row.category_id)
  )

  let productStock: Record<string, number> = {}
  let variantStock: Record<string, number> = {}

  if (params.includeStock) {
    const snapshot = await computeStoreStock(params.storeId, productIds)
    productStock = snapshot.productStock
    variantStock = snapshot.variantStock
  }

  const products = buildCatalogProducts({
    products: pageRows,
    variants,
    images,
    categories,
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
  const [variants, images] = await Promise.all([
    fetchCatalogVariants([String(product.id)]),
    fetchCatalogImages([String(product.id)]),
  ])
  const categories = await fetchCatalogCategories(params.storeId, [product.category_id])

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
    images,
    categories,
    productStock,
    variantStock,
    currency,
    includeStock: params.includeStock,
  })

  return catalogProduct || null
}
