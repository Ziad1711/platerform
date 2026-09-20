import { createAdminClient } from '@/lib/supabase/admin'
import type { IngestOrderPayload } from './ingest-order'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ItemValidationError = { errorCode: string; errorMessage: string }

/**
 * Valide le rattachement produit / variante AVANT l'insertion de la commande.
 * Le client admin contourne la RLS : les contrôles de store sont donc faits ici.
 * - produit existant et appartenant au store de la clé API
 * - variante existante, du même store et rattachée au même produit
 * - product_variant_id obligatoire dès que le produit possède des variantes
 *   (stock par variante, ou pack avec multiplicateur de stock).
 */
export async function validateOrderItems(
  storeId: string,
  items: IngestOrderPayload['items']
): Promise<ItemValidationError | null> {
  const supabase = createAdminClient()

  const productIds = Array.from(new Set(items.map((item) => String(item?.product_id || '').trim())))
  const variantIds = Array.from(
    new Set(items.map((item) => String(item?.product_variant_id || '').trim()).filter(Boolean))
  )

  if (productIds.includes('')) {
    return {
      errorCode: 'MISSING_PRODUCT_ID',
      errorMessage: 'Chaque article doit contenir un product_id (colonne "ID" de la page Produits).',
    }
  }

  if (productIds.some((id) => !UUID_PATTERN.test(id))) {
    return { errorCode: 'INVALID_PRODUCT_ID', errorMessage: 'product_id invalide : un UUID Jisra est attendu.' }
  }

  if (variantIds.some((id) => !UUID_PATTERN.test(id))) {
    return { errorCode: 'INVALID_VARIANT_ID', errorMessage: 'product_variant_id invalide : un UUID Jisra est attendu.' }
  }

  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, store_id')
    .in('id', productIds)

  if (productsError) {
    return { errorCode: 'PRODUCT_LOOKUP_FAILED', errorMessage: productsError.message }
  }

  const variantsById = new Map<string, any>()

  if (variantIds.length > 0) {
    const { data: variants, error: variantsError } = await supabase
      .from('product_variants')
      .select('id, product_id, store_id')
      .in('id', variantIds)

    if (variantsError) {
      return { errorCode: 'VARIANT_LOOKUP_FAILED', errorMessage: variantsError.message }
    }

    for (const row of variants || []) {
      variantsById.set(String((row as any).id), row)
    }
  }

  const { data: productVariants, error: productVariantsError } = await supabase
    .from('product_variants')
    .select('product_id')
    .in('product_id', productIds)

  if (productVariantsError) {
    return { errorCode: 'VARIANT_LOOKUP_FAILED', errorMessage: productVariantsError.message }
  }

  const productsById = new Map<string, any>((products || []).map((row: any) => [String(row.id), row]))
  const variantCountByProduct = new Map<string, number>()

  for (const row of productVariants || []) {
    const key = String((row as any).product_id)
    variantCountByProduct.set(key, (variantCountByProduct.get(key) || 0) + 1)
  }

  for (const item of items) {
    const productId = String(item.product_id).trim()
    const product = productsById.get(productId)

    if (!product) {
      return { errorCode: 'PRODUCT_NOT_FOUND', errorMessage: `Produit introuvable pour ce store : ${productId}` }
    }

    if (product.store_id && String(product.store_id) !== String(storeId)) {
      return {
        errorCode: 'PRODUCT_NOT_IN_STORE',
        errorMessage: `Le produit ${productId} n'appartient pas au store de cette clé API.`,
      }
    }

    const variantId = String(item.product_variant_id || '').trim()

    if (!variantId) {
      if ((variantCountByProduct.get(productId) || 0) > 0) {
        return {
          errorCode: 'VARIANT_REQUIRED',
          errorMessage:
            `Le produit ${productId} possède des variantes : product_variant_id est obligatoire ` +
            '(stock par variante ou pack avec quantité).',
        }
      }
      continue
    }

    const variant = variantsById.get(variantId)

    if (!variant) {
      return { errorCode: 'VARIANT_NOT_FOUND', errorMessage: `Variante introuvable : ${variantId}` }
    }

    if (variant.store_id && String(variant.store_id) !== String(storeId)) {
      return {
        errorCode: 'VARIANT_NOT_IN_STORE',
        errorMessage: `La variante ${variantId} n'appartient pas au store de cette clé API.`,
      }
    }

    if (String(variant.product_id) !== productId) {
      return {
        errorCode: 'VARIANT_PRODUCT_MISMATCH',
        errorMessage: `La variante ${variantId} n'appartient pas au produit ${productId}.`,
      }
    }
  }

  return null
}
