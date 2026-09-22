import { resolveVariantAvailableStock } from './catalog-stock'
import {
  buildProductPrice,
  resolvePublicImageUrl,
  type CatalogCategoryRef,
  type CatalogImage,
  type CatalogProduct,
  type CatalogVariant,
  type CategoryRow,
  type ProductImageRow,
  type ProductRow,
  type VariantRow,
} from './catalog-shared'

function sortImages(images: ProductImageRow[]): ProductImageRow[] {
  return [...images].sort((a, b) => {
    const orderDiff = Number(a.sort_order || 0) - Number(b.sort_order || 0)
    if (orderDiff !== 0) return orderDiff

    const createdDiff = String(a.created_at || '').localeCompare(String(b.created_at || ''))
    if (createdDiff !== 0) return createdDiff

    return String(a.id).localeCompare(String(b.id))
  })
}

function buildCatalogImages(images: ProductImageRow[]): CatalogImage[] {
  return sortImages(images).map((row) => ({
    id: String(row.id),
    url: resolvePublicImageUrl(row.image_url),
    alt: row.alt_text ? String(row.alt_text) : null,
    sort_order: Number(row.sort_order || 0),
    is_primary: Boolean(row.is_primary),
  }))
}

/** Image principale d'un jeu d'images, avec repli sur la première image disponible. */
function resolvePrimaryImageUrl(images: ProductImageRow[]): string | null {
  const sorted = sortImages(images)
  const primary = sorted.find((row) => Boolean(row.is_primary)) || sorted[0] || null
  return primary ? resolvePublicImageUrl(primary.image_url) : null
}

function buildCatalogVariants(params: {
  variants: VariantRow[]
  variantImages: Map<string, ProductImageRow[]>
  productPrimaryImageUrl: string | null
  stockTrackingMode: string
  productStock: number
  variantStock: Record<string, number>
  includeStock: boolean
}): CatalogVariant[] {
  const {
    variants,
    variantImages,
    productPrimaryImageUrl,
    stockTrackingMode,
    productStock,
    variantStock,
    includeStock,
  } = params

  const sorted = [...variants].sort((a, b) => {
    const orderDiff = Number(a.sort_order || 0) - Number(b.sort_order || 0)
    if (orderDiff !== 0) return orderDiff

    const createdDiff = String(a.created_at || '').localeCompare(String(b.created_at || ''))
    if (createdDiff !== 0) return createdDiff

    return String(a.id).localeCompare(String(b.id))
  })

  const entries = sorted.map((variant) => {
    const rows = variantImages.get(String(variant.id)) || []
    const ownImageUrl = resolvePrimaryImageUrl(rows)

    const entry: CatalogVariant = {
      id: String(variant.id),
      name: String(variant.name || ''),
      sku: String(variant.sku || ''),
      selling_price: Number(variant.selling_price || 0),
      old_price:
        variant.old_price === null || variant.old_price === undefined
          ? null
          : Number(variant.old_price),
      image_url: ownImageUrl || productPrimaryImageUrl,
      images: buildCatalogImages(rows),
      is_default: Boolean(variant.is_default),
      sort_order: Number(variant.sort_order || 0),
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

  // Repli : si aucune variante n'est marquée par défaut en base, la première de la liste l'est.
  if (entries.length > 0 && !entries.some((entry) => entry.is_default)) {
    entries[0].is_default = true
  }

  return entries
}

/**
 * Construit les produits exposés au site client (prix, variantes, stock optionnel).
 * Seuls les produits publiés (`active`) sont transmis par les requêtes amont.
 */
export function buildCatalogProducts(params: {
  products: ProductRow[]
  variants: VariantRow[]
  images: ProductImageRow[]
  categories: Map<string, CategoryRow>
  productStock: Record<string, number>
  variantStock: Record<string, number>
  currency: string
  includeStock: boolean
}): CatalogProduct[] {
  const {
    products,
    variants,
    images,
    categories,
    productStock,
    variantStock,
    currency,
    includeStock,
  } = params

  const variantsByProduct = new Map<string, VariantRow[]>()
  for (const variant of variants) {
    const productId = String(variant.product_id || '')
    if (!productId) continue
    const list = variantsByProduct.get(productId) || []
    list.push(variant)
    variantsByProduct.set(productId, list)
  }

  const productImagesByProduct = new Map<string, ProductImageRow[]>()
  const variantImagesByVariant = new Map<string, ProductImageRow[]>()

  for (const image of images) {
    const productId = String(image.product_id || '')
    if (!productId) continue

    const variantId = image.product_variant_id ? String(image.product_variant_id) : null

    if (variantId) {
      const list = variantImagesByVariant.get(variantId) || []
      list.push(image)
      variantImagesByVariant.set(variantId, list)
      continue
    }

    const list = productImagesByProduct.get(productId) || []
    list.push(image)
    productImagesByProduct.set(productId, list)
  }

  return products.map((product) => {
    const productId = String(product.id)
    const stockTrackingMode = String(product.stock_tracking_mode || 'variant')
    const productVariants = variantsByProduct.get(productId) || []
    const totalStock = Math.max(Number(productStock[productId] || 0), 0)
    const productImages = productImagesByProduct.get(productId) || []

    // Repli historique : `products.image_url` si aucune image de galerie n'existe encore.
    const galleryPrimaryImageUrl = resolvePrimaryImageUrl(productImages)
    const productImageUrl = galleryPrimaryImageUrl || resolvePublicImageUrl(product.image_url)

    const catalogVariants = buildCatalogVariants({
      variants: productVariants,
      variantImages: variantImagesByVariant,
      productPrimaryImageUrl: productImageUrl,
      stockTrackingMode,
      productStock: totalStock,
      variantStock,
      includeStock,
    })

    const price = buildProductPrice(product, productVariants, currency)
    const categoryRow = product.category_id ? categories.get(String(product.category_id)) : undefined
    const category: CatalogCategoryRef | null = categoryRow
      ? {
          id: String(categoryRow.id),
          name: String(categoryRow.name || ''),
          slug: String(categoryRow.slug || ''),
        }
      : null

    const result: CatalogProduct = {
      id: productId,
      name: String(product.name || ''),
      slug: product.slug ? String(product.slug) : null,
      sku: product.sku || null,
      short_description: product.short_description ? String(product.short_description) : null,
      description: product.description ? String(product.description) : null,
      category,
      image_url: productImageUrl,
      images: buildCatalogImages(productImages),
      selling_price: price.min,
      old_price: product.old_price === null || product.old_price === undefined ? null : Number(product.old_price),
      stock_tracking_mode: stockTrackingMode,
      publication_status: String(product.publication_status || 'active'),
      sort_order: Number(product.sort_order || 0),
      price,
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
