import { resolveVariantAvailableStock } from './catalog-stock'
import {
  buildProductPrice,
  resolvePublicImageUrl,
  type CatalogProduct,
  type CatalogVariant,
  type ProductRow,
  type VariantRow,
} from './catalog-shared'

function buildCatalogVariants(params: {
  variants: VariantRow[]
  stockTrackingMode: string
  productStock: number
  variantStock: Record<string, number>
  includeStock: boolean
}): CatalogVariant[] {
  const { variants, stockTrackingMode, productStock, variantStock, includeStock } = params

  return variants.map((variant) => {
    const entry: CatalogVariant = {
      id: String(variant.id),
      name: String(variant.name || ''),
      sku: String(variant.sku || ''),
      selling_price: Number(variant.selling_price || 0),
      option_values: variant.option_values || {},
    }

    if (includeStock) {
      const available = resolveVariantAvailableStock({
        stockTrackingMode,
        productStock,
        variantStock: Number(variantStock[String(variant.id)] || 0),
        stockMultiplier: Number(variant.stock_multiplier || 1),
      })

      entry.available_stock = available
      entry.is_available = available > 0
    }

    return entry
  })
}

/**
 * Construit les produits exposés au site client (prix, variantes, stock optionnel).
 * Seuls les produits publiés (`active`) sont transmis par les requêtes amont.
 */
export function buildCatalogProducts(params: {
  products: ProductRow[]
  variants: VariantRow[]
  productStock: Record<string, number>
  variantStock: Record<string, number>
  currency: string
  includeStock: boolean
}): CatalogProduct[] {
  const { products, variants, productStock, variantStock, currency, includeStock } = params

  const variantsByProduct = new Map<string, VariantRow[]>()
  for (const variant of variants) {
    const productId = String(variant.product_id || '')
    if (!productId) continue
    const list = variantsByProduct.get(productId) || []
    list.push(variant)
    variantsByProduct.set(productId, list)
  }

  return products.map((product) => {
    const productId = String(product.id)
    const stockTrackingMode = String(product.stock_tracking_mode || 'variant')
    const productVariants = variantsByProduct.get(productId) || []
    const totalStock = Math.max(Number(productStock[productId] || 0), 0)

    const catalogVariants = buildCatalogVariants({
      variants: productVariants,
      stockTrackingMode,
      productStock: totalStock,
      variantStock,
      includeStock,
    })

    const result: CatalogProduct = {
      id: productId,
      name: String(product.name || ''),
      sku: product.sku || null,
      image_url: resolvePublicImageUrl(product.image_url),
      stock_tracking_mode: stockTrackingMode,
      publication_status: String(product.publication_status || 'active'),
      price: buildProductPrice(product, productVariants, currency),
      variants: catalogVariants,
      has_variants: catalogVariants.length > 0,
      updated_at: product.updated_at,
    }

    if (includeStock) {
      // Produit sans variante : le stock produit fait référence.
      // Produit en mode « variant » : somme des stocks disponibles des variantes.
      const variantModeStock = catalogVariants.reduce(
        (sum, variant) => sum + Number(variant.available_stock || 0),
        0
      )

      result.available_stock =
        stockTrackingMode === 'variant' && catalogVariants.length > 0 ? variantModeStock : totalStock
      result.is_available = Number(result.available_stock || 0) > 0
    }

    return result
  })
}
