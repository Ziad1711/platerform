import { createAdminClient } from '@/lib/supabase/admin'
import { isValidUuid } from './catalog-shared'
import { buildResolvedItems } from './order-items-validation'

export type ItemValidationError = { errorCode: string; errorMessage: string }

export type IncomingOrderItem = {
  product_id: string
  product_variant_id?: string | null
  quantity: number
  /** Prix envoyé par le site : ignoré en mode strict, conservé pour comparaison. */
  unit_selling_price?: number
}

export type ResolvedOrderItem = {
  product_id: string
  product_variant_id: string | null
  quantity: number
  /** Prix appliqué, issu de la base Jisra (source de vérité). */
  unit_selling_price: number
  /** Prix envoyé par le site, conservé pour journalisation uniquement. */
  requested_unit_price: number
}

export type PriceMismatch = {
  product_id: string
  product_variant_id: string | null
  requested: number
  applied: number
}

export type OrderItemsPricingResult =
  | { error: ItemValidationError; items: null; mismatches: PriceMismatch[] }
  | { error: null; items: ResolvedOrderItem[]; mismatches: PriceMismatch[] }

function safeQuantity(raw: unknown): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.trunc(parsed)
}

/**
 * Valide le rattachement produit/variante ET applique les prix Jisra (mode strict).
 * - produit existant et appartenant au store de la clé API
 * - variante existante, du même store et rattachée au même produit
 * - `product_variant_id` obligatoire dès que le produit possède des variantes
 * - le prix envoyé par le site n'est jamais appliqué : seul le prix Jisra compte
 *
 * Le client admin contourne la RLS : les contrôles de store sont donc faits ici.
 */
export async function resolveOrderItemsPricing(
  storeId: string,
  items: IncomingOrderItem[]
): Promise<OrderItemsPricingResult> {
  const supabase = createAdminClient()
  const error = (validationError: ItemValidationError): OrderItemsPricingResult => ({
    error: validationError,
    items: null,
    mismatches: [],
  })

  const requested = (items || []).map((item) => ({
    productId: String(item?.product_id || '').trim(),
    variantId: String(item?.product_variant_id || '').trim(),
    quantity: safeQuantity(item?.quantity),
    requestedPrice: Number(item?.unit_selling_price || 0),
  }))

  const productIds = Array.from(new Set(requested.map((item) => item.productId).filter(Boolean)))
  const variantIds = Array.from(new Set(requested.map((item) => item.variantId).filter(Boolean)))

  if (productIds.includes('')) {
    return error({
      errorCode: 'MISSING_PRODUCT_ID',
      errorMessage: 'Chaque article doit contenir un product_id (colonne "ID" de la page Produits).',
    })
  }

  if (productIds.some((id) => !isValidUuid(id))) {
    return error({
      errorCode: 'INVALID_PRODUCT_ID',
      errorMessage: 'product_id invalide : un UUID Jisra est attendu.',
    })
  }

  if (variantIds.some((id) => !isValidUuid(id))) {
    return error({
      errorCode: 'INVALID_VARIANT_ID',
      errorMessage: 'product_variant_id invalide : un UUID Jisra est attendu.',
    })
  }

  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, store_id, default_selling_price')
    .in('id', productIds)

  if (productsError) {
    return error({ errorCode: 'PRODUCT_LOOKUP_FAILED', errorMessage: productsError.message })
  }

  const { data: variants, error: variantsError } = await supabase
    .from('product_variants')
    .select('id, product_id, store_id, selling_price')
    .in('product_id', productIds)

  if (variantsError) {
    return error({ errorCode: 'VARIANT_LOOKUP_FAILED', errorMessage: variantsError.message })
  }

  return buildResolvedItems({
    storeId,
    requested,
    products: (products || []) as any[],
    variants: (variants || []) as any[],
    error,
  })
}

/**
 * Total de la commande (mode strict) : sous-total Jisra - remise + livraison.
 * Les frais de livraison facturés au client proviennent du site.
 */
export function resolveOrderTotal(params: {
  itemsTotal: number
  discountAmount: number
  deliveryChargeToCustomer: number
}): number {
  const computed =
    Number(params.itemsTotal || 0) -
    Number(params.discountAmount || 0) +
    Number(params.deliveryChargeToCustomer || 0)

  return Number(Math.max(computed, 0).toFixed(2))
}
