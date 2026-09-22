type SupabaseLike = any

export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const PRODUCT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export type ImageSyncInput = {
  /** Image déjà enregistrée : mise à jour au lieu d'un insert. */
  id?: string | null
  image_url: string
  alt_text?: string | null
  sort_order: number
  is_primary: boolean
}

/** Élément de galerie provenant de l'interface (fichier local ou image déjà stockée). */
export type GalleryInput = {
  id?: string | null
  url: string
  file?: File | null
  previewUrl?: string
  alt_text?: string | null
  is_primary: boolean
}

const STORAGE_MARKER = '/storage/v1/object/public/products/'
/** Chemin relatif au bucket : `{store_uuid}/{product_uuid}/fichier.ext`. */
const BUCKET_RELATIVE_PATH =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f-]{36}\//i

export function validateProductImageFile(file: File): void {
  const type = String(file?.type || '').toLowerCase()

  if (!PRODUCT_IMAGE_MIME_TYPES.includes(type)) {
    throw new Error('Format d’image non supporté (JPEG, PNG ou WebP attendu).')
  }

  if (Number(file?.size || 0) > PRODUCT_IMAGE_MAX_BYTES) {
    throw new Error('Image trop lourde (5 Mo maximum).')
  }
}

/** URL publique affichable pour une image produit (chemin Storage ou URL externe). */
export function resolveProductImageUrl(supabase: SupabaseLike, raw: string | null | undefined): string | null {
  const value = String(raw || '').trim()
  if (!value) return null
  if (/^(https?:|data:)/i.test(value)) return value

  const cleanPath = value.replace(/^\/+/, '')
  const { data } = supabase.storage.from('products').getPublicUrl(cleanPath)
  return data?.publicUrl || null
}

/**
 * Chemin Storage d'une image gérée par Jisra.
 * Accepte les URLs publiques du bucket `products` et les chemins relatifs enregistrés
 * dans `product_images.image_url` (format `{store}/{product}/fichier.ext`).
 * Renvoie `null` pour les images externes (YouCan, Unsplash, ...) qui ne doivent jamais être supprimées.
 */
export function productStoragePath(raw: string | null | undefined): string | null {
  const value = String(raw || '').trim()
  if (!value) return null

  const markerIndex = value.indexOf(STORAGE_MARKER)

  if (markerIndex !== -1) {
    const path = value.slice(markerIndex + STORAGE_MARKER.length).split('?')[0]
    return path ? decodeURIComponent(path) : null
  }

  // Toute autre URL absolue est externe : jamais supprimée du Storage.
  if (/^(https?:|data:)/i.test(value)) return null

  const relative = value.replace(/^\/+/, '').split('?')[0]
  if (!BUCKET_RELATIVE_PATH.test(relative)) return null

  return decodeURIComponent(relative)
}

/**
 * Supprime du Storage les fichiers réellement gérés par Jisra (les URLs externes sont ignorées).
 * Un fichier encore référencé par une autre fiche produit (produit dupliqué) n'est jamais supprimé.
 */
export async function deleteManagedProductImages(params: {
  supabase: SupabaseLike
  imageUrls: Array<string | null | undefined>
}): Promise<void> {
  const { supabase, imageUrls } = params

  const managedValues = Array.from(
    new Set(
      imageUrls
        .map((url) => String(url || '').trim())
        .filter((value) => Boolean(value) && Boolean(productStoragePath(value)))
    )
  )

  if (managedValues.length === 0) return

  // Vérifie qu'aucune autre fiche ne référence encore ces fichiers (duplication de produit).
  const { data: stillReferenced } = await supabase
    .from('product_images')
    .select('image_url')
    .in('image_url', managedValues)

  const referenced = new Set(
    ((stillReferenced || []) as Array<{ image_url: string | null }>).map((row) =>
      String(row.image_url || '').trim()
    )
  )

  const paths = Array.from(
    new Set(
      managedValues
        .filter((value) => !referenced.has(value))
        .map((value) => productStoragePath(value))
        .filter((path): path is string => Boolean(path))
    )
  )

  if (paths.length === 0) return

  const { error } = await supabase.storage.from('products').remove(paths)
  if (error) console.error('[PRODUCT_IMAGE_STORAGE_DELETE]', error)
}

/** Upload d'une image et retour de son chemin Storage (relatif au bucket `products`). */
/**
 * Synchronise les images d'un périmètre :
 * - `productVariantId` null    -> galerie produit ;
 * - `productVariantId` défini  -> galerie de la variante.
 * Les images absentes du payload sont supprimées (fichiers Jisra compris).
 * Les variantes existantes conservent leur `id` : aucune recréation inutile.
 */
export async function syncProductImages(params: {
  supabase: SupabaseLike
  storeId: string
  productId: string
  productVariantId?: string | null
  images: ImageSyncInput[]
  /** Pour la galerie produit : recopie l'image principale dans `products.image_url`. */
  syncProductMainImage?: boolean
}): Promise<{ keptIds: string[]; removedIds: string[] }> {
  const {
    supabase,
    storeId,
    productId,
    productVariantId = null,
    images,
    syncProductMainImage = false,
  } = params

  const now = new Date().toISOString()
  const scope = (query: SupabaseLike) =>
    productVariantId
      ? query.eq('product_id', productId).eq('product_variant_id', productVariantId)
      : query.eq('product_id', productId).is('product_variant_id', null)

  const { data: existingRows, error: existingError } = await scope(
    supabase.from('product_images').select('id, image_url, is_primary')
  )

  if (existingError) throw existingError

  const existing = (existingRows || []) as Array<{
    id: string
    image_url: string
    is_primary: boolean
  }>
  const existingById = new Map(existing.map((row) => [String(row.id), row]))

  const payload = (images || [])
    .map((image, index) => ({
      id: image.id && existingById.has(String(image.id)) ? String(image.id) : null,
      image_url: String(image.image_url || '').trim(),
      alt_text: image.alt_text ? String(image.alt_text).trim() : null,
      sort_order: Number.isFinite(Number(image.sort_order))
        ? Math.max(0, Math.trunc(Number(image.sort_order)))
        : index,
      is_primary: Boolean(image.is_primary),
    }))
    .filter((image) => image.image_url.length > 0)

  // Une seule image principale à la fois : libère la contrainte unique avant écriture.
  if (payload.some((image) => image.is_primary)) {
    const { error } = await scope(
      supabase.from('product_images').update({ is_primary: false, updated_at: now })
    ).eq('is_primary', true)

    if (error) throw error
  }

  const keptIds = new Set(payload.map((image) => image.id).filter((id): id is string => Boolean(id)))
  const removed = existing.filter((row) => !keptIds.has(String(row.id)))

  if (removed.length > 0) {
    const { error } = await supabase
      .from('product_images')
      .delete()
      .in(
        'id',
        removed.map((row) => row.id)
      )

    if (error) throw error

    await deleteManagedProductImages({
      supabase,
      imageUrls: removed.map((row) => row.image_url),
    })
  }

  const resolvedIds: string[] = []

  for (const image of payload) {
    if (image.id) {
      const { error } = await supabase
        .from('product_images')
        .update({
          image_url: image.image_url,
          alt_text: image.alt_text,
          sort_order: image.sort_order,
          is_primary: image.is_primary,
          product_variant_id: productVariantId,
          updated_at: now,
        })
        .eq('id', image.id)

      if (error) throw error
      resolvedIds.push(image.id)
      continue
    }

    const { data: inserted, error } = await supabase
      .from('product_images')
      .insert({
        store_id: storeId,
        product_id: productId,
        product_variant_id: productVariantId,
        image_url: image.image_url,
        alt_text: image.alt_text,
        sort_order: image.sort_order,
        is_primary: image.is_primary,
      })
      .select('id')
      .single()

    if (error) throw error
    resolvedIds.push(String(inserted.id))
  }

  // Garantit qu'il existe toujours une image principale affichable.
  if (payload.length > 0 && !payload.some((image) => image.is_primary) && resolvedIds[0]) {
    const { error } = await supabase
      .from('product_images')
      .update({ is_primary: true, updated_at: now })
      .eq('id', resolvedIds[0])

    if (error) throw error
  }

  if (syncProductMainImage) {
    const primary = payload.find((image) => image.is_primary) || payload[0] || null
    const { error } = await supabase
      .from('products')
      .update({ image_url: primary ? primary.image_url : null })
      .eq('id', productId)

    if (error) throw error
  }

  return { keptIds: resolvedIds, removedIds: removed.map((row) => row.id) }
}

/**
 * Enregistre une galerie (produit ou variante) depuis l'interface :
 * - les fichiers locaux sont uploadés puis référencés par leur chemin Storage ;
 * - les images retirées (absentes de `items`) sont supprimées ;
 * - `sort_order` suit l'ordre visuel, l'image principale est explicite.
 */
export async function saveGalleryImages(params: {
  supabase: SupabaseLike
  storeId: string
  productId: string
  productVariantId?: string | null
  items: GalleryInput[]
  syncProductMainImage?: boolean
}): Promise<{ keptIds: string[]; removedIds: string[] }> {
  const {
    supabase,
    storeId,
    productId,
    productVariantId = null,
    items,
    syncProductMainImage = false,
  } = params

  const uploadedPaths: string[] = []

  try {
    const payload: ImageSyncInput[] = []

    for (const [index, item] of (items || []).entries()) {
      let url = String(item?.url || '').trim()

      if (!url && item?.file) {
        url = await uploadProductImage({
          supabase,
          storeId,
          productId,
          productVariantId,
          file: item.file,
        })
        uploadedPaths.push(url)
      }

      if (!url) continue

      payload.push({
        id: item.id || null,
        image_url: url,
        alt_text: item.alt_text ? String(item.alt_text).trim() : null,
        sort_order: index,
        is_primary: Boolean(item.is_primary),
      })
    }

    const result = await syncProductImages({
      supabase,
      storeId,
      productId,
      productVariantId,
      images: payload,
      syncProductMainImage: syncProductMainImage && !productVariantId,
    })

    // Les aperçus locaux ne servent plus une fois les fichiers envoyés.
    for (const item of items || []) {
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
    }

    return result
  } catch (error) {
    // Aucun état partiel : les fichiers uploadés pendant l'opération sont retirés.
    await deleteManagedProductImages({ supabase, imageUrls: uploadedPaths })
    throw error
  }
}

/** Upload d'une image et retour de son chemin Storage (relatif au bucket `products`). */
export async function uploadProductImage(params: {
  supabase: SupabaseLike
  storeId: string
  productId: string
  productVariantId?: string | null
  file: File
}): Promise<string> {

  const { supabase, storeId, productId, productVariantId, file } = params

  validateProductImageFile(file)

  const extension = (String(file.name || '').split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const folder = productVariantId
    ? `${storeId}/${productId}/variants/${productVariantId}`
    : `${storeId}/${productId}`
  const filePath = `${folder}/${unique}.${extension || 'jpg'}`

  const { error } = await supabase.storage
    .from('products')
    .upload(filePath, file, { cacheControl: '3600', upsert: false })

  if (error) throw error
  return filePath
}
