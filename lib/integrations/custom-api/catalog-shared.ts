import { createAdminClient } from '@/lib/supabase/admin'

export const DEFAULT_CATALOG_LIMIT = 50
export const MAX_CATALOG_LIMIT = 200

/** Seul ce statut de publication est exposé au site client. */
export const ACTIVE_PUBLICATION_STATUS = 'active'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const PRODUCT_COLUMNS =
  'id, name, slug, sku, short_description, description, image_url, old_price, sort_order, category_id, stock_tracking_mode, publication_status, default_selling_price, updated_at, created_at'

export const VARIANT_COLUMNS =
  'id, product_id, name, sku, selling_price, old_price, is_default, sort_order, option_values, stock_multiplier, created_at'

export const IMAGE_COLUMNS =
  'id, product_id, product_variant_id, image_url, alt_text, sort_order, is_primary, created_at'

export const CATEGORY_COLUMNS = 'id, store_id, name, slug, description, image_url, sort_order'

/** Image de galerie exposée au site client (produit ou variante). */
export type CatalogImage = {
  id: string
  url: string | null
  alt: string | null
  sort_order: number
  is_primary: boolean
}

export type CatalogCategoryRef = {
  id: string
  name: string
  slug: string
}

export type CatalogVariant = {
  id: string
  name: string
  sku: string
  selling_price: number
  /** Ancien prix affiché (prix barré), `null` si absent. */
  old_price: number | null
  /** Image principale de la variante (fallback : image principale du produit). */
  image_url: string | null
  images: CatalogImage[]
  is_default: boolean
  sort_order: number
  option_values: Record<string, unknown>
  /** Présent uniquement si la clé API possède le périmètre stock:read */
  available_stock?: number
  is_available?: boolean
}

export type CatalogProduct = {
  id: string
  name: string
  slug: string | null
  sku: string | null
  short_description: string | null
  description: string | null
  category: CatalogCategoryRef | null
  image_url: string | null
  images: CatalogImage[]
  selling_price: number
  old_price: number | null
  stock_tracking_mode: string
  publication_status: string
  sort_order: number
  price: { min: number; max: number; currency: string }
  variants: CatalogVariant[]
  has_variants: boolean
  /** Présents uniquement si la clé API possède le périmètre stock:read */
  available_stock?: number
  is_available?: boolean
  updated_at: string | null
}

export type ProductRow = {
  id: string
  name: string | null
  slug: string | null
  sku: string | null
  short_description: string | null
  description: string | null
  image_url: string | null
  old_price: number | null
  sort_order: number | null
  category_id: string | null
  stock_tracking_mode: string | null
  publication_status: string | null
  default_selling_price: number | null
  updated_at: string | null
  created_at: string | null
}

export type VariantRow = {
  id: string
  product_id: string
  name: string | null
  sku: string | null
  selling_price: number | null
  old_price: number | null
  is_default: boolean | null
  sort_order: number | null
  option_values: Record<string, unknown> | null
  stock_multiplier: number | null
  created_at: string | null
}

export type ProductImageRow = {
  id: string
  product_id: string
  product_variant_id: string | null
  image_url: string | null
  alt_text: string | null
  sort_order: number | null
  is_primary: boolean | null
  created_at: string | null
}

export type CategoryRow = {
  id: string
  store_id: string
  name: string | null
  slug: string | null
  description: string | null
  image_url: string | null
  sort_order: number | null
}

export function isValidUuid(value: string | null | undefined): boolean {
  return UUID_PATTERN.test(String(value || '').trim())
}

export function clampCatalogLimit(raw: string | null | undefined): number {
  const parsed = Number(String(raw ?? '').trim())
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CATALOG_LIMIT
  return Math.min(Math.trunc(parsed), MAX_CATALOG_LIMIT)
}

export function resolvePublicImageUrl(imageUrl: string | null | undefined): string | null {
  const raw = String(imageUrl || '').trim()
  if (!raw) return null
  if (/^(https?:|data:)/i.test(raw)) return raw

  const supabase = createAdminClient()
  const { data } = supabase.storage.from('products').getPublicUrl(raw.replace(/^\/+/, ''))
  return data?.publicUrl || null
}

export function buildProductPrice(
  product: ProductRow,
  variants: VariantRow[],
  currency: string
): { min: number; max: number; currency: string } {
  const variantPrices = variants
    .map((variant) => Number(variant.selling_price || 0))
    .filter((price) => Number.isFinite(price) && price > 0)

  const values = variantPrices.length > 0 ? variantPrices : [Number(product.default_selling_price || 0)]
  const safeValues = values.filter((value) => Number.isFinite(value))

  return {
    min: safeValues.length > 0 ? Math.min(...safeValues) : 0,
    max: safeValues.length > 0 ? Math.max(...safeValues) : 0,
    currency,
  }
}
