import { createAdminClient } from '@/lib/supabase/admin'
import {
  computeStoreStock,
  getStoreCurrency,
  resolveVariantAvailableStock,
  type StoreStockSnapshot,
} from './catalog-stock'
import { isValidUuid } from './catalog'

export type AvailabilityRequestItem = {
  product_id: string
  product_variant_id?: string | null
  quantity: number
}

export type AvailabilityItemResult = {
  product_id: string
  product_variant_id: string | null
  requested_quantity: number
  is_available: boolean
  available_stock: number
  unit_selling_price: number
  line_total: number
  price_source: 'variant' | 'product' | 'unknown'
  reason: string | null
}

export type AvailabilityResult = {
  currency: string
  is_available: boolean
  items: AvailabilityItemResult[]
  subtotal_amount: number
  unavailable_count: number
}

type ProductRow = {
  id: string
  store_id: string | null
  stock_tracking_mode: string | null
  default_selling_price: number | null
}

type VariantRow = {
  id: string
  product_id: string
  store_id: string | null
  selling_price: number | null
  stock_multiplier: number | null
}

function safeQuantity(raw: unknown): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.trunc(parsed)
}

function buildItemResult(
  base: Omit<AvailabilityItemResult, 'line_total'>
): AvailabilityItemResult {
  return {
    ...base,
    line_total: Number((base.unit_selling_price * base.requested_quantity).toFixed(2)),
  }
}

/**
 * Vérifie la disponibilité (existence, prix Jisra et stock) d'un panier
 * avant la création de la commande côté site.
 */
export async function checkItemsAvailability(
  storeId: string,
  items: AvailabilityRequestItem[]
): Promise<AvailabilityResult> {
  const supabase = createAdminClient()
  const currency = await getStoreCurrency(storeId)

  const requested = (items || []).map((item) => ({
    productId: String(item?.product_id || '').trim(),
    variantId: String(item?.product_variant_id || '').trim(),
    quantity: safeQuantity(item?.quantity),
  }))

  const productIds = Array.from(new Set(requested.map((item) => item.productId).filter(Boolean)))
  const uuidProductIds = productIds.filter((id) => isValidUuid(id))

  const products = new Map<string, ProductRow>()
  const variants = new Map<string, VariantRow>()
  const variantCountByProduct = new Map<string, number>()

  if (uuidProductIds.length > 0) {
    const [{ data: productRows }, { data: variantRows }, { data: allVariants }] = await Promise.all([
      supabase
        .from('products')
        .select('id, store_id, stock_tracking_mode, default_selling_price')
        .eq('store_id', storeId)
        .in('id', uuidProductIds),
      supabase
        .from('product_variants')
        .select('id, product_id, store_id, selling_price, stock_multiplier')
        .eq('store_id', storeId)
        .in('product_id', uuidProductIds),
      supabase.from('product_variants').select('product_id').in('product_id', uuidProductIds),
    ])

    for (const row of (productRows || []) as ProductRow[]) {
      products.set(String(row.id), row)
    }

    for (const row of (variantRows || []) as VariantRow[]) {
      variants.set(String(row.id), row)
      const productId = String(row.product_id)
      variantCountByProduct.set(productId, (variantCountByProduct.get(productId) || 0) + 1)
    }

    for (const row of allVariants || []) {
      const productId = String((row as { product_id: string }).product_id || '')
      if (productId && !variantCountByProduct.has(productId)) {
        variantCountByProduct.set(productId, 1)
      }
    }
  }

  const snapshot = await computeStoreStock(storeId, uuidProductIds)
  const results = requested.map((item) =>
    resolveItem({ item, products, variants, variantCountByProduct, snapshot })
  )
  const unavailableCount = results.filter((item) => !item.is_available).length
  const subtotal = results.reduce((sum, item) => sum + item.line_total, 0)

  return {
    currency,
    is_available: results.length > 0 && unavailableCount === 0,
    items: results,
    subtotal_amount: Number(subtotal.toFixed(2)),
    unavailable_count: unavailableCount,
  }
}

type ResolveItemParams = {
  item: { productId: string; variantId: string; quantity: number }
  products: Map<string, ProductRow>
  variants: Map<string, VariantRow>
  variantCountByProduct: Map<string, number>
  snapshot: StoreStockSnapshot
}

function resolveItem(params: ResolveItemParams): AvailabilityItemResult {
  const { item, products, variants, variantCountByProduct, snapshot } = params

  const base = {
    product_id: item.productId,
    product_variant_id: item.variantId || null,
    requested_quantity: item.quantity,
    is_available: false,
    available_stock: 0,
    unit_selling_price: 0,
    price_source: 'unknown' as const,
    reason: null as string | null,
  }

  if (!item.productId) {
    return buildItemResult({ ...base, reason: 'MISSING_PRODUCT_ID' })
  }

  if (!isValidUuid(item.productId)) {
    return buildItemResult({ ...base, reason: 'INVALID_PRODUCT_ID' })
  }

  const product = products.get(item.productId)

  if (!product) {
    return buildItemResult({ ...base, reason: 'PRODUCT_NOT_FOUND' })
  }

  if ((variantCountByProduct.get(item.productId) || 0) > 0 && !item.variantId) {
    return buildItemResult({ ...base, reason: 'VARIANT_REQUIRED' })
  }

  let unitPrice = Number(product.default_selling_price || 0)
  let priceSource: AvailabilityItemResult['price_source'] = 'product'
  let multiplier = 1

  if (item.variantId) {
    if (!isValidUuid(item.variantId)) {
      return buildItemResult({ ...base, reason: 'INVALID_VARIANT_ID' })
    }

    const variant = variants.get(item.variantId)

    if (!variant) {
      return buildItemResult({ ...base, reason: 'VARIANT_NOT_FOUND' })
    }

    if (String(variant.product_id) !== item.productId) {
      return buildItemResult({ ...base, reason: 'VARIANT_PRODUCT_MISMATCH' })
    }

    unitPrice = Number(variant.selling_price || 0)
    priceSource = 'variant'
    multiplier = Number(variant.stock_multiplier || 1)
  }

  const productStock = Math.max(Number(snapshot.productStock[item.productId] || 0), 0)

  // Produit sans variante : le stock produit fait référence (les mouvements
  // peuvent porter `stock_tracking_mode: 'variant'` par défaut sans variante réelle).
  const availableStock = item.variantId
    ? resolveVariantAvailableStock({
        stockTrackingMode: product.stock_tracking_mode,
        productStock,
        variantStock: Number(snapshot.variantStock[item.variantId] || 0),
        stockMultiplier: multiplier,
      })
    : productStock

  const hasEnoughStock = item.quantity > 0 && availableStock >= item.quantity

  return buildItemResult({
    ...base,
    is_available: hasEnoughStock,
    available_stock: availableStock,
    unit_selling_price: unitPrice,
    price_source: priceSource,
    reason: hasEnoughStock ? null : item.quantity <= 0 ? 'INVALID_QUANTITY' : 'INSUFFICIENT_STOCK',
  })
}
