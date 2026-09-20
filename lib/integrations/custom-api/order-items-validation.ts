import type {
  ItemValidationError,
  OrderItemsPricingResult,
  PriceMismatch,
  ResolvedOrderItem,
} from './order-items-pricing'

type RequestedItem = {
  productId: string
  variantId: string
  quantity: number
  requestedPrice: number
}

type ProductLookup = {
  id: string
  store_id: string | null
  default_selling_price: number | null
}

type VariantLookup = {
  id: string
  product_id: string
  store_id: string | null
  selling_price: number | null
}

/**
 * Applique les règles de rattachement produit/variante et fige les prix Jisra.
 * Les prix envoyés par le site sont conservés uniquement pour détecter les écarts.
 */
export function buildResolvedItems(params: {
  storeId: string
  requested: RequestedItem[]
  products: ProductLookup[]
  variants: VariantLookup[]
  error: (validationError: ItemValidationError) => OrderItemsPricingResult
}): OrderItemsPricingResult {
  const { storeId, requested, products, variants, error } = params

  const productsById = new Map<string, ProductLookup>()
  for (const product of products) {
    productsById.set(String(product.id), product)
  }

  const variantsById = new Map<string, VariantLookup>()
  const variantCountByProduct = new Map<string, number>()

  for (const variant of variants) {
    variantsById.set(String(variant.id), variant)
    const productId = String(variant.product_id)
    variantCountByProduct.set(productId, (variantCountByProduct.get(productId) || 0) + 1)
  }

  const resolved: ResolvedOrderItem[] = []
  const mismatches: PriceMismatch[] = []

  for (const item of requested) {
    const product = productsById.get(item.productId)

    if (!product) {
      return error({
        errorCode: 'PRODUCT_NOT_FOUND',
        errorMessage: `Produit introuvable pour ce store : ${item.productId}`,
      })
    }

    if (product.store_id && String(product.store_id) !== String(storeId)) {
      return error({
        errorCode: 'PRODUCT_NOT_IN_STORE',
        errorMessage: `Le produit ${item.productId} n'appartient pas au store de cette clé API.`,
      })
    }

    const hasVariants = (variantCountByProduct.get(item.productId) || 0) > 0

    if (!item.variantId && hasVariants) {
      return error({
        errorCode: 'VARIANT_REQUIRED',
        errorMessage:
          `Le produit ${item.productId} possède des variantes : product_variant_id est obligatoire ` +
          '(stock par variante ou pack avec quantité).',
      })
    }

    if (item.quantity <= 0) {
      return error({
        errorCode: 'INVALID_QUANTITY',
        errorMessage: `Quantité invalide pour le produit ${item.productId}.`,
      })
    }

    let unitPrice = Number(product.default_selling_price || 0)

    if (item.variantId) {
      const variant = variantsById.get(item.variantId)

      if (!variant) {
        return error({
          errorCode: 'VARIANT_NOT_FOUND',
          errorMessage: `Variante introuvable : ${item.variantId}`,
        })
      }

      if (variant.store_id && String(variant.store_id) !== String(storeId)) {
        return error({
          errorCode: 'VARIANT_NOT_IN_STORE',
          errorMessage: `La variante ${item.variantId} n'appartient pas au store de cette clé API.`,
        })
      }

      if (String(variant.product_id) !== item.productId) {
        return error({
          errorCode: 'VARIANT_PRODUCT_MISMATCH',
          errorMessage: `La variante ${item.variantId} n'appartient pas au produit ${item.productId}.`,
        })
      }

      unitPrice = Number(variant.selling_price || 0)
    }

    if (item.requestedPrice > 0 && item.requestedPrice !== unitPrice) {
      mismatches.push({
        product_id: item.productId,
        product_variant_id: item.variantId || null,
        requested: item.requestedPrice,
        applied: unitPrice,
      })
    }

    resolved.push({
      product_id: item.productId,
      product_variant_id: item.variantId || null,
      quantity: item.quantity,
      unit_selling_price: unitPrice,
      requested_unit_price: item.requestedPrice,
    })
  }

  return { error: null, items: resolved, mismatches }
}
