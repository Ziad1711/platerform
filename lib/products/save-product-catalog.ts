import { deleteManagedProductImages, uploadProductImage } from './product-images'

type SupabaseLike = any

export type CatalogGalleryInput = {
  id?: string | null
  url: string
  file?: File | null
  previewUrl?: string
  alt_text?: string | null
  is_primary: boolean
}

export type CatalogVariantInput = {
  id?: string | null
  name: string
  sku: string
  selling_price: number
  purchase_cost: number
  old_price: number | null
  is_default: boolean
  sort_order: number
  stock_multiplier: number
  option_values: Record<string, string>
}

export type SaveProductCatalogParams = {
  supabase: SupabaseLike
  storeId: string
  /** `null` (création) : un identifiant est généré avant l'upload des fichiers. */
  productId?: string | null
  product: {
    name: string
    slug: string | null
    sku: string | null
    short_description: string | null
    description: string | null
    old_price: number | null
    category_id: string | null
    sort_order: number
    default_selling_price: number
    default_purchase_cost: number
    stock_tracking_mode: string
    publication_status: string
    confirm_stock_setup?: boolean
  }
  /** `null` = variantes non touchées. Tableau vide = aucune variante (sans suppression). */
  variants?: Array<CatalogVariantInput & { images?: CatalogGalleryInput[] }> | null
  /** `null` = galerie produit non touchée. */
  images?: CatalogGalleryInput[] | null
}

function generateId(): string {
  const cryptoApi = globalThis.crypto

  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16)
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

function buildItemsPayload(items: CatalogGalleryInput[] | null | undefined, resolveUrl: (item: CatalogGalleryInput, index: number) => string) {
  return (items || [])
    .map((item, index) => ({
      id: item.id || null,
      image_url: resolveUrl(item, index),
      alt_text: item.alt_text ? String(item.alt_text).trim() : null,
      sort_order: index,
      is_primary: Boolean(item.is_primary),
    }))
    .filter((item) => item.image_url.length > 0)
}

function revokePreviews(items: CatalogGalleryInput[] | null | undefined) {
  for (const item of items || []) {
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
  }
}

/**
 * Enregistre un produit, ses variantes et ses images en une seule opération :
 * 1. les nouveaux fichiers sont envoyés dans le Storage (l'identifiant produit est connu d'avance) ;
 * 2. une RPC transactionnelle écrit produit + variantes + images ;
 * 3. en cas d'échec, les fichiers envoyés sont retirés (aucun état partiel).
 */
export async function saveProductCatalog(params: SaveProductCatalogParams): Promise<{ productId: string }> {
  const { supabase, storeId, product, variants = null, images = null } = params

  const productId = params.productId || generateId()
  const uploadedPaths: string[] = []
  const uploadedUrls: string[] = []

  try {
    const uploadItems = async (
      items: CatalogGalleryInput[] | null | undefined,
      productVariantId: string | null
    ) => {
      const resolved = new Map<CatalogGalleryInput, string>()

      for (const item of items || []) {
        const existingUrl = String(item.url || '').trim()
        if (existingUrl) {
          resolved.set(item, existingUrl)
          continue
        }

        if (!item.file) continue

        const path = await uploadProductImage({
          supabase,
          storeId,
          productId,
          productVariantId,
          file: item.file,
        })

        uploadedPaths.push(path)
        uploadedUrls.push(path)
        resolved.set(item, path)
      }

      return resolved
    }

    const productResolved = await uploadItems(images, null)
    const variantsResolved = new Map<number, Map<CatalogGalleryInput, string>>()

    if (variants) {
      for (const [index, variant] of variants.entries()) {
        const resolved = await uploadItems(variant.images, variant.id || null)
        variantsResolved.set(index, resolved)
      }
    }

    const variantsPayload = variants
      ? variants.map((variant, index) => ({
          id: variant.id || null,
          name: variant.name,
          sku: variant.sku,
          selling_price: variant.selling_price,
          purchase_cost: variant.purchase_cost,
          old_price: variant.old_price,
          is_default: variant.is_default,
          sort_order: variant.sort_order,
          stock_multiplier: variant.stock_multiplier,
          option_values: variant.option_values,
          images: buildItemsPayload(
            variant.images,
            (item) => variantsResolved.get(index)?.get(item) || String(item.url || '').trim()
          ),
        }))
      : null

    const imagesPayload = images
      ? buildItemsPayload(images, (item) => productResolved.get(item) || String(item.url || '').trim())
      : null

    const { data, error } = await supabase.rpc('rpc_save_product_catalog', {
      p_store_id: storeId,
      p_product: { ...product, id: productId },
      p_variants: variantsPayload,
      p_images: imagesPayload,
    })

    if (error) throw error

    revokePreviews(images)
    for (const variant of variants || []) revokePreviews(variant.images)

    const removedUrls: string[] = Array.isArray(data?.removed_image_urls) ? data.removed_image_urls : []
    if (removedUrls.length > 0) {
      await deleteManagedProductImages({ supabase, imageUrls: removedUrls })
    }

    return { productId: String(data?.product_id || productId) }
  } catch (error) {
    // Aucun état partiel : les fichiers envoyés pendant l'opération sont retirés.
    await deleteManagedProductImages({ supabase, imageUrls: uploadedUrls })

    const message = String((error as any)?.message || '')

    if (message.includes('STORE_ACCESS_DENIED')) {
      throw new Error("Vous n'avez pas les droits pour modifier les produits de ce store.")
    }
    if (message.includes('PRODUCT_CATEGORY_STORE_MISMATCH')) {
      throw new Error('La catégorie choisie appartient à un autre store.')
    }
    if (message.includes('PRODUCT_NOT_FOUND')) {
      throw new Error('Produit introuvable dans ce store.')
    }
    if (message.includes('products_store_slug_unique')) {
      throw new Error('Ce slug est déjà utilisé par un autre produit de ce store.')
    }

    throw error
  }
}
