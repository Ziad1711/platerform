import { listYouCanOrders, listYouCanProducts } from '@/lib/integrations/youcan'
import { detectStockMultiplier } from '@/lib/integrations/variant-stock'
import { normalizeMoroccanPhone } from '@/lib/utils'
import { buildUniqueProductSlug } from '@/lib/products/slug'
type SupabaseAdmin = any

function parseDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function normalizeAddressNode(value: any) {
  if (!value) return null

  if (Array.isArray(value)) {
    const firstObject = value.find((item) => item && typeof item === 'object' && !Array.isArray(item))
    return firstObject || null
  }

  if (typeof value === 'object') {
    return value
  }

  return null
}

function isMeaningfulAddress(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0) return false

  // Reject values that are only punctuation, whitespace, or separators
  // e.g. ",", ", ", " ,", " - ", etc.
  const onlyPunctuation = /^[\s,;\-./\\|_]+$/.test(trimmed)
  if (onlyPunctuation) return false

  // Must contain at least one alphanumeric character (including Unicode/arabic)
  // to be meaningful. \p{L} matches any Unicode letter, \p{N} any Unicode number.
  return /[\p{L}\p{N}]/u.test(trimmed)
}

/** Generic: picks the first non-blank string from a list. No address-specific validation. */
function pickFirstNonBlankString(...values: any[]) {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const normalized = value.trim()
    if (normalized.length > 0) return normalized
  }

  return null
}

/** Address-specific: picks the first string that passes isMeaningfulAddress. */
function pickFirstNonEmptyAddress(...values: any[]) {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const normalized = value.trim()
    if (normalized.length > 0 && isMeaningfulAddress(normalized)) return normalized
  }

  return null
}

function pickAddressLine(addressNode: any) {
  if (!addressNode || typeof addressNode !== 'object') return null

  const extraFields =
    addressNode?.extra_fields && typeof addressNode.extra_fields === 'object'
      ? addressNode.extra_fields
      : null

  return pickFirstNonEmptyAddress(
    addressNode?.first_line,
    addressNode?.second_line,
    addressNode?.address,
    addressNode?.line1,
    addressNode?.line_1,
    addressNode?.street,
    addressNode?.full_address,
    addressNode?.Adresse,
    extraFields?.Adresse,
    extraFields?.address,
    extraFields?.line1,
    extraFields?.street,
    addressNode?.location
  )
}

function normalizeVariantSku(variant: any, youcanVariantId: string) {
  const rawSku = String(variant?.sku || '').trim()
  if (rawSku) return rawSku
  return `youcan:${youcanVariantId}`
}

function getVariantOptionValues(variant: any) {
  const raw = variant?.variations
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}

  const normalizedEntries = Object.entries(raw as Record<string, any>)
    .map(([key, value]) => [String(key || '').trim(), String(value || '').trim()] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0)
    .filter(([key, value]) => {
      const k = key.toLowerCase()
      const v = value.toLowerCase()

      // Placeholder YouCan variant: { Title: "Default Title" } / { title: "default" }
      if (k === 'default' && v === 'default') return false
      if (k === 'title' && (v === 'default' || v === 'default title')) return false
      return true
    })

  return Object.fromEntries(normalizedEntries)
}

function buildVariantDisplayName(variant: any) {
  const explicitName = String(variant?.name || '').trim()
  if (explicitName) return explicitName

  const optionValues = getVariantOptionValues(variant)
  const pairs = Object.entries(optionValues)
    .map(([key, value]) => `${String(key || '').trim()}: ${String(value || '').trim()}`)
    .filter((entry) => !entry.endsWith(':'))

  if (pairs.length > 0) return pairs.join(' / ')
  return 'Default'
}
/** Convertit une description HTML YouCan en texte simple exploitable par le site. */
function htmlToPlainText(value: any): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  const text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return text || null
}

function buildShortDescription(value: string | null, maxLength = 180): string | null {
  if (!value) return null
  if (value.length <= maxLength) return value

  const cut = value.slice(0, maxLength)
  const lastSpace = cut.lastIndexOf(' ')
  const base = lastSpace > 40 ? cut.slice(0, lastSpace) : cut
  return `${base.trim()}…`
}

function toPositiveAmount(value: any): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** Galerie produit YouCan, triée par `order` (repli sur la miniature). */
function getYouCanProductImages(product: any): Array<{ url: string; alt: string | null; order: number }> {
  const list = Array.isArray(product?.images) ? product.images : []

  const images = list
    .map((image: any) => ({
      url: String(image?.variations?.original || image?.url || '').trim(),
      alt: String(image?.name || '').trim() || null,
      order: Number(image?.order ?? 0),
    }))
    .filter((image) => /^https?:/i.test(image.url))

  if (images.length > 0) {
    return images.sort((a, b) => a.order - b.order)
  }

  const thumbnail = String(product?.thumbnail || '').trim()
  return /^https?:/i.test(thumbnail) ? [{ url: thumbnail, alt: null, order: 0 }] : []
}

function getYouCanVariantImageUrl(variant: any): string | null {
  const url = String(variant?.image?.url || variant?.image?.original || '').trim()
  return /^https?:/i.test(url) ? url : null
}



function shouldImportProductVariant(variant: any, totalVariants: number) {
  if (totalVariants > 1) return true

  const optionValues = getVariantOptionValues(variant)
  return Object.keys(optionValues).length > 0
}

/**
 * Ajoute les images YouCan manquantes sans jamais supprimer une image locale.
 * Seules des URLs externes sont référencées : aucun fichier Jisra n'est touché.
 */
async function syncYouCanProductImages(params: {
  supabase: SupabaseAdmin
  storeId: string
  productId: string
  productVariantId?: string | null
  images: Array<{ url: string; alt?: string | null }>
}) {
  const { supabase, storeId, productId, productVariantId = null, images } = params
  if (images.length === 0) return

  const scope = (query: any) =>
    productVariantId
      ? query.eq('product_id', productId).eq('product_variant_id', productVariantId)
      : query.eq('product_id', productId).is('product_variant_id', null)

  const { data: existingRows, error } = await scope(
    supabase.from('product_images').select('id, image_url, sort_order, is_primary')
  )

  if (error) throw error

  const existing = (existingRows || []) as Array<{
    id: string
    image_url: string
    sort_order: number
    is_primary: boolean
  }>

  const knownUrls = new Set(existing.map((row) => String(row.image_url || '').trim()))
  let hasPrimary = existing.some((row) => Boolean(row.is_primary))
  let nextOrder = existing.reduce((max, row) => Math.max(max, Number(row.sort_order || 0)), -1) + 1

  for (const image of images) {
    const url = String(image.url || '').trim()
    if (!url || knownUrls.has(url)) continue

    const isPrimary = !hasPrimary

    const { error: insertError } = await supabase.from('product_images').insert({
      store_id: storeId,
      product_id: productId,
      product_variant_id: productVariantId,
      image_url: url,
      alt_text: image.alt || null,
      sort_order: nextOrder,
      is_primary: isPrimary,
    })

    if (insertError) throw insertError

    knownUrls.add(url)
    nextOrder += 1
    if (isPrimary) hasPrimary = true
  }
}

async function upsertProductFromYouCan(params: {
  supabase: SupabaseAdmin
  integrationId: string
  userId: string
  storeId: string
  product: any
}) {
  const { supabase, integrationId, userId, storeId, product } = params

  const youcanProductId = String(product?.id || '')
  if (!youcanProductId) return null

  const { data: existingMap } = await supabase
    .from('youcan_entity_mappings')
    .select('internal_id')
    .eq('integration_id', integrationId)
    .eq('entity_type', 'product')
    .eq('youcan_id', youcanProductId)
    .maybeSingle()

  const defaultSellingPrice = Number(product?.price || 0)
  const defaultPurchaseCost = Number(product?.cost_price || 0)
  const youcanDescription = htmlToPlainText(product?.description)
  const youcanImages = getYouCanProductImages(product)
  const youcanOldPrice = toPositiveAmount(product?.compare_at_price)
  const youcanSlug = String(product?.slug || '').trim()
  const thumbnail =
    youcanImages[0]?.url || (product?.thumbnail ? String(product.thumbnail).trim() : null)

  let productId = existingMap?.internal_id || null
  let existingProduct: any = null

  if (productId) {
    const { data } = await supabase
      .from('products')
      .select('id, slug, short_description, description, old_price, image_url')
      .eq('id', productId)
      .maybeSingle()

    existingProduct = data || null
    if (!existingProduct) {
      productId = null
    }
  }

  if (!productId) {
    const slug = await buildUniqueProductSlug({
      supabase,
      storeId,
      base: youcanSlug || String(product?.name || 'Produit YouCan'),
    })

    const { data: inserted, error } = await supabase
      .from('products')
      .insert({
        store_id: storeId,
        name: String(product?.name || 'Produit YouCan'),
        slug,
        sku: null,
        short_description: buildShortDescription(youcanDescription),
        description: youcanDescription,
        old_price: youcanOldPrice,
        default_selling_price: Number.isFinite(defaultSellingPrice) ? defaultSellingPrice : 0,
        default_purchase_cost: Number.isFinite(defaultPurchaseCost) ? defaultPurchaseCost : 0,
        image_url: thumbnail,
      })
      .select('id')
      .single()

    if (error) throw error
    productId = inserted.id
  } else {
    // Les informations commerciales déjà saisies dans Jisra ne sont jamais écrasées par la source.
    const updatePayload: Record<string, any> = {
      name: String(product?.name || 'Produit YouCan'),
      default_selling_price: Number.isFinite(defaultSellingPrice) ? defaultSellingPrice : 0,
      default_purchase_cost: Number.isFinite(defaultPurchaseCost) ? defaultPurchaseCost : 0,
      updated_at: new Date().toISOString(),
    }

    if (!String(existingProduct?.slug || '').trim()) {
      updatePayload.slug = await buildUniqueProductSlug({
        supabase,
        storeId,
        base: youcanSlug || String(product?.name || 'Produit YouCan'),
        excludeProductId: productId,
      })
    }

    if (youcanDescription && !String(existingProduct?.description || '').trim()) {
      updatePayload.description = youcanDescription
      updatePayload.short_description = buildShortDescription(youcanDescription)
    }

    if (youcanOldPrice && existingProduct?.old_price === null) {
      updatePayload.old_price = youcanOldPrice
    }

    if (thumbnail && !String(existingProduct?.image_url || '').trim()) {
      updatePayload.image_url = thumbnail
    }

    await supabase.from('products').update(updatePayload).eq('id', productId)
  }

  await syncYouCanProductImages({
    supabase,
    storeId,
    productId: String(productId),
    images: youcanImages.map((image) => ({ url: image.url, alt: image.alt })),
  })

  await supabase.from('youcan_entity_mappings').upsert(
    {
      user_id: userId,
      integration_id: integrationId,
      store_id: storeId,
      entity_type: 'product',
      youcan_id: youcanProductId,
      internal_id: productId,
      payload: product,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'integration_id,entity_type,youcan_id' }
  )

  return { productId, youcanProductId }
}

/** Garantit qu'une variante reste marquée par défaut après une synchronisation. */
async function ensureDefaultVariant(params: { supabase: SupabaseAdmin; productId: string }) {
  const { supabase, productId } = params

  const { data: defaultRows, error } = await supabase
    .from('product_variants')
    .select('id')
    .eq('product_id', productId)
    .eq('is_default', true)
    .limit(1)

  if (error) throw error
  if (defaultRows && defaultRows.length > 0) return

  const { data: candidates, error: candidatesError } = await supabase
    .from('product_variants')
    .select('id')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)

  if (candidatesError) throw candidatesError
  const first = candidates?.[0]?.id
  if (!first) return

  await supabase
    .from('product_variants')
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq('id', first)
}

async function upsertVariantFromYouCan(params: {
  supabase: SupabaseAdmin
  integrationId: string
  userId: string
  storeId: string
  productId: string
  variant: any
  allowWithoutOptions?: boolean
  variantIndex?: number
}) {
  const {
    supabase,
    integrationId,
    userId,
    storeId,
    productId,
    variant,
    allowWithoutOptions = false,
    variantIndex = 0,
  } = params

  const youcanVariantId = String(variant?.id || '')
  if (!youcanVariantId) return null

  const { data: existingMap } = await supabase
    .from('youcan_entity_mappings')
    .select('internal_id')
    .eq('integration_id', integrationId)
    .eq('entity_type', 'variant')
    .eq('youcan_id', youcanVariantId)
    .maybeSingle()

  const sellingPrice = Number(variant?.price || 0)
  const purchaseCost = Number(variant?.cost_price || 0)
  const oldPrice = toPositiveAmount(variant?.compare_at_price)
  const variantImageUrl = getYouCanVariantImageUrl(variant)
  const sku = normalizeVariantSku(variant, youcanVariantId)
  const optionValues = getVariantOptionValues(variant)
  if (!allowWithoutOptions && Object.keys(optionValues).length === 0) {
    return null
  }
  const variantName = buildVariantDisplayName(variant)
  const stockMultiplier = detectStockMultiplier({ name: variantName, optionValues })

  const { data: existingProduct } = await supabase
    .from('products')
    .select('id')
    .eq('id', productId)
    .maybeSingle()

  if (!existingProduct) {
    throw new Error(`PRODUCT_NOT_FOUND_FOR_VARIANT:${productId}`)
  }

  let variantId = existingMap?.internal_id || null
  let existingVariantRow: any = null

  if (variantId) {
    const { data } = await supabase
      .from('product_variants')
      .select('id, old_price')
      .eq('id', variantId)
      .maybeSingle()

    existingVariantRow = data || null

    if (!existingVariantRow) {
      variantId = null
    }
  }

  if (!variantId) {
    const { data: existingBySku } = await supabase
      .from('product_variants')
      .select('id, old_price')
      .eq('product_id', productId)
      .eq('sku', sku)
      .maybeSingle()

    variantId = existingBySku?.id || null
    existingVariantRow = existingBySku || null
  }

  if (!variantId) {
    const { data: inserted, error } = await supabase
      .from('product_variants')
      .insert({
        store_id: storeId,
        product_id: productId,
        name: variantName,
        sku,
        selling_price: Number.isFinite(sellingPrice) ? sellingPrice : 0,
        purchase_cost: Number.isFinite(purchaseCost) ? purchaseCost : 0,
        old_price: oldPrice,
        sort_order: Math.max(0, Math.trunc(variantIndex)),
        option_values: optionValues,
        stock_multiplier: stockMultiplier,
      })
      .select('id')
      .single()

    if (error) throw error
    variantId = inserted.id
  } else {
    await supabase
      .from('product_variants')
      .update({
        product_id: productId,
        name: variantName,
        sku,
        selling_price: Number.isFinite(sellingPrice) ? sellingPrice : 0,
        purchase_cost: Number.isFinite(purchaseCost) ? purchaseCost : 0,
        // Les informations saisies manuellement dans Jisra restent prioritaires.
        ...(oldPrice && existingVariantRow?.old_price === null ? { old_price: oldPrice } : {}),
        sort_order: Math.max(0, Math.trunc(variantIndex)),
        option_values: optionValues,
        // Un multiplicateur détecté explicitement (ex: "3 pièces") met à jour la variante.
        // Sinon on conserve la valeur configurée manuellement.
        ...(stockMultiplier > 1 ? { stock_multiplier: stockMultiplier } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', variantId)
  }

  if (variantImageUrl) {
    await syncYouCanProductImages({
      supabase,
      storeId,
      productId,
      productVariantId: String(variantId),
      images: [{ url: variantImageUrl, alt: variantName }],
    })
  }

  await supabase.from('youcan_entity_mappings').upsert(
    {
      user_id: userId,
      integration_id: integrationId,
      store_id: storeId,
      entity_type: 'variant',
      youcan_id: youcanVariantId,
      internal_id: variantId,
      payload: variant,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'integration_id,entity_type,youcan_id' }
  )

  return { variantId, youcanVariantId }
}

export type YouCanPendingVariantSetup = {
  productId: string
  productName: string
  stockTrackingMode: 'shared' | 'variant'
  variants: Array<{
    id: string
    name: string
    sku: string
    sellingPrice: number
    stockMultiplier: number
  }>
}

export async function importYouCanProducts(params: {
  supabase: SupabaseAdmin
  integrationId: string
  userId: string
  storeId: string
  accessToken: string
}) {
  const { supabase, integrationId, userId, storeId, accessToken } = params

  let page = 1
  let imported = 0
  const pendingVariantSetup: YouCanPendingVariantSetup[] = []

  // Les produits dont la configuration stock/variantes a déjà été confirmée
  // ne sont plus proposés à chaque synchronisation.
  const { data: configuredRows, error: configuredError } = await supabase
    .from('products')
    .select('id, stock_setup_confirmed_at, stock_tracking_mode')
    .eq('store_id', storeId)

  if (configuredError) throw configuredError

  const configuredProductIds = new Set(
    (configuredRows || [])
      .filter((row: any) => Boolean(row.stock_setup_confirmed_at))
      .map((row: any) => String(row.id))
  )

  const productModeById = new Map<string, 'shared' | 'variant'>(
    (configuredRows || []).map((row: any) => [
      String(row.id),
      row.stock_tracking_mode === 'shared' ? 'shared' : 'variant',
    ])
  )

  while (true) {
    const payload = await listYouCanProducts({ accessToken, page })
    const products = payload.data || []

    for (const product of products) {
      const upsertedProduct = await upsertProductFromYouCan({
        supabase,
        integrationId,
        userId,
        storeId,
        product,
      })

      const productId = upsertedProduct?.productId
      if (!productId) continue

      const rawVariants = Array.isArray(product?.variants) ? product.variants : []
      const variants = rawVariants.filter((variant: any) =>
        shouldImportProductVariant(variant, rawVariants.length)
      )

      const variantRefs: YouCanPendingVariantSetup['variants'] = []

      for (const [variantIndex, variant] of variants.entries()) {
        const upsertedVariant = await upsertVariantFromYouCan({
          supabase,
          integrationId,
          userId,
          storeId,
          productId,
          variant,
          allowWithoutOptions: rawVariants.length > 1,
          variantIndex,
        })

        if (!upsertedVariant?.variantId) continue

        const label = buildVariantDisplayName(variant)
        variantRefs.push({
          id: String(upsertedVariant.variantId),
          name: label,
          sku: normalizeVariantSku(variant, String(variant?.id || '')),
          sellingPrice: Number(variant?.price || 0),
          stockMultiplier: detectStockMultiplier({
            name: label,
            optionValues: getVariantOptionValues(variant),
          }),
        })
      }

      // Quantités explicites fournies par la source (ex: "2 unités") => packs quantité
      // sur un stock unique : le mode est déduit sans ambiguïté, aucune confirmation requise.
      const hasExplicitPackQuantity =
        variantRefs.length >= 2 && variantRefs.some((variant) => variant.stockMultiplier > 1)

      if (hasExplicitPackQuantity) {
        await supabase
          .from('products')
          .update({
            stock_tracking_mode: 'shared',
            stock_setup_confirmed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', productId)
          .eq('store_id', storeId)
      }

      // Plusieurs variantes dont aucune n'indique une quantité explicite
      // => probable pack quantité à confirmer par l'utilisateur.
      const needsVariantSetup =
        variantRefs.length >= 2 &&
        variantRefs.every((variant) => variant.stockMultiplier === 1) &&
        !configuredProductIds.has(String(productId))

      if (needsVariantSetup) {
        pendingVariantSetup.push({
          productId,
          productName: String(product?.name || 'Produit YouCan'),
          stockTrackingMode: productModeById.get(String(productId)) || 'variant',
          variants: variantRefs,
        })
      }

      // Le site doit toujours recevoir une variante présélectionnable.
      if (variantRefs.length > 0) {
        await ensureDefaultVariant({ supabase, productId: String(productId) })
      }

      imported += 1
    }

    const totalPages = Number(payload.meta?.pagination?.total_pages || 1)
    if (page >= totalPages) break
    page += 1
  }

  return { imported, pendingVariantSetup }
}

async function resolveInternalVariantAndProduct(params: {
  supabase: SupabaseAdmin
  integrationId: string
  storeId: string
  userId: string
  line: any
}) {
  const { supabase, integrationId, storeId, userId, line } = params
  const variantNode = line?.variant || {}
  const productNode = variantNode?.product || {}

  const youcanVariantId = String(variantNode?.id || line?.id || '')
  const youcanProductId = String(productNode?.id || '')
  const hasRealVariations = Object.keys(getVariantOptionValues({ variations: variantNode?.variations })).length > 0

  let internalProductId: string | null = null
  let internalVariantId: string | null = null

  if (youcanProductId) {
    const { data: productMap } = await supabase
      .from('youcan_entity_mappings')
      .select('internal_id')
      .eq('integration_id', integrationId)
      .eq('entity_type', 'product')
      .eq('youcan_id', youcanProductId)
      .maybeSingle()
    internalProductId = productMap?.internal_id || null
  }

  if (youcanVariantId && hasRealVariations) {
    const { data: variantMap } = await supabase
      .from('youcan_entity_mappings')
      .select('internal_id')
      .eq('integration_id', integrationId)
      .eq('entity_type', 'variant')
      .eq('youcan_id', youcanVariantId)
      .maybeSingle()
    internalVariantId = variantMap?.internal_id || null

    // Auto-repair: if the mapped variant no longer exists in product_variants,
    // reset the mapping to null so it gets rebuilt
    if (internalVariantId) {
      const { data: existingVariant } = await supabase
        .from('product_variants')
        .select('id')
        .eq('id', internalVariantId)
        .maybeSingle()

      if (!existingVariant) {
        // Stale mapping — clear it so upsertVariantFromYouCan will recreate
        await supabase
          .from('youcan_entity_mappings')
          .update({ internal_id: null, updated_at: new Date().toISOString() })
          .eq('integration_id', integrationId)
          .eq('entity_type', 'variant')
          .eq('youcan_id', youcanVariantId)

        internalVariantId = null
      }
    }
  }

  if (!internalProductId) {
    const upsertedProduct = await upsertProductFromYouCan({
      supabase,
      integrationId,
      userId,
      storeId,
      product: {
        id: youcanProductId || `fallback-${youcanVariantId}`,
        name: String(productNode?.name || 'Produit YouCan'),
        price: Number(line?.price || variantNode?.price || 0),
        cost_price: Number(variantNode?.cost_price || 0),
        thumbnail: productNode?.thumbnail || null,
      },
    })
    internalProductId = upsertedProduct?.productId || null
  }

  if (!internalVariantId && internalProductId && youcanVariantId && hasRealVariations) {
    const upsertedVariant = await upsertVariantFromYouCan({
      supabase,
      integrationId,
      userId,
      storeId,
      productId: internalProductId,
      variant: {
        id: youcanVariantId,
            name: variantNode?.name || 'Default',
        sku: variantNode?.sku || '',
        price: Number(line?.price || variantNode?.price || 0),
        cost_price: Number(variantNode?.cost_price || 0),
        variations: variantNode?.variations || {},
      },
    })
    internalVariantId = upsertedVariant?.variantId || null
  }

  return { internalProductId, internalVariantId, youcanVariantId }
}

export async function upsertYouCanOrderFromPayload(params: {
  supabase: SupabaseAdmin
  integrationId: string
  userId: string
  storeId: string
  order: any
  sinceDate?: string
}) {
  const { supabase, integrationId, userId, storeId, order, sinceDate } = params

  const createdAt = String(order?.created_at || '')
  const since = parseDate(sinceDate)
  const orderCreatedAt = parseDate(createdAt)
  if (since && orderCreatedAt && orderCreatedAt < since) {
    return { skipped: true }
  }

  const youcanOrderId = String(order?.id || '')
  if (!youcanOrderId) return { skipped: true }

  const { data: existingOrderMap } = await supabase
    .from('youcan_entity_mappings')
    .select('internal_id')
    .eq('integration_id', integrationId)
    .eq('entity_type', 'order')
    .eq('youcan_id', youcanOrderId)
    .maybeSingle()

  const customer = order?.customer || {}
  const shipping = order?.shipping || {}
  const payment = order?.payment || {}
  const shippingAddress = normalizeAddressNode(shipping?.address)
  const paymentAddress = normalizeAddressNode(payment?.address)
  const customerAddress = normalizeAddressNode(customer?.address)

  const customerNameFromFirstAndLast = `${String(customer?.first_name || '').trim()} ${String(customer?.last_name || '').trim()}`.trim()
  const customerName =
    pickFirstNonBlankString(customerNameFromFirstAndLast, customer?.full_name) || 'Client YouCan'

  const phone = normalizeMoroccanPhone(pickFirstNonBlankString(
    customer?.phone,
    shippingAddress?.phone,
    paymentAddress?.phone,
    customerAddress?.phone
  ))

  const address = pickFirstNonEmptyAddress(
    pickAddressLine(shippingAddress),
    pickAddressLine(paymentAddress),
    pickAddressLine(customerAddress)
  )

  const city = pickFirstNonBlankString(
    shippingAddress?.city,
    paymentAddress?.city,
    customerAddress?.city,
    customer?.city
  )

  const total = Number(order?.total || 0)
  const shippingPrice = Number(shipping?.price || 0)

  let internalOrderId = existingOrderMap?.internal_id || null
  if (internalOrderId) {
    const { data: existingOrderRow } = await supabase
      .from('orders')
      .select('id')
      .eq('id', internalOrderId)
      .maybeSingle()

    if (!existingOrderRow) {
      internalOrderId = null
    }
  }

  if (!internalOrderId) {
    const { data: insertedOrder, error: insertOrderError } = await supabase
      .from('orders')
      .insert({
        store_id: storeId,
        customer_name: customerName,
        phone,
        address,
        city: city,
        status: 'new',
        order_date: orderCreatedAt ? orderCreatedAt.toISOString() : new Date().toISOString(),
        total_selling_price: Number.isFinite(total) ? total : 0,
        delivery_charge_to_customer: Number.isFinite(shippingPrice) ? shippingPrice : 0,
        source: 'ads',
      })
      .select('id')
      .single()

    if (insertOrderError) throw insertOrderError
    internalOrderId = insertedOrder.id
  } else {
    const orderUpdatePayload: Record<string, any> = {
      customer_name: customerName,
      phone,
      source: 'ads',
      total_selling_price: Number.isFinite(total) ? total : 0,
      delivery_charge_to_customer: Number.isFinite(shippingPrice) ? shippingPrice : 0,
      updated_at: new Date().toISOString(),
    }

    if (address) {
      orderUpdatePayload.address = address
    }

    if (city) {
      orderUpdatePayload.city = city
    }

    await supabase
      .from('orders')
      .update(orderUpdatePayload)
      .eq('id', internalOrderId)

    await supabase.from('order_items').delete().eq('order_id', internalOrderId)
  }

  const lines = Array.isArray(order?.variants) ? order.variants : []
  const orderItems: any[] = []

  for (const line of lines) {
    const quantity = Number(line?.quantity || 1)
    const price = Number(line?.price || 0)
    const resolved = await resolveInternalVariantAndProduct({
      supabase,
      integrationId,
      storeId,
      userId,
      line,
    })

    if (!resolved.internalProductId) continue

    orderItems.push({
      store_id: storeId,
      order_id: internalOrderId,
      product_id: resolved.internalProductId,
      product_variant_id: resolved.internalVariantId,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      unit_selling_price: Number.isFinite(price) ? price : 0,
      unit_purchase_cost_snapshot: 0,
      item_type: 'product',
    })
  }

  if (orderItems.length > 0) {
    const { error: itemsError } = await supabase.from('order_items').insert(orderItems)
    if (itemsError) {
      // Cleanup: if this is a newly created order and items failed, remove the orphan order
      if (!existingOrderMap?.internal_id) {
        await supabase.from('orders').delete().eq('id', internalOrderId)
      }
      throw itemsError
    }
  }

  await supabase.from('youcan_entity_mappings').upsert(
    {
      user_id: userId,
      integration_id: integrationId,
      store_id: storeId,
      entity_type: 'order',
      youcan_id: youcanOrderId,
      internal_id: internalOrderId,
      payload: order,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'integration_id,entity_type,youcan_id' }
  )

  return { skipped: false, internalOrderId }
}

export async function importYouCanOrders(params: {
  supabase: SupabaseAdmin
  integrationId: string
  userId: string
  storeId: string
  accessToken: string
  sinceDate: string
}) {
  const { supabase, integrationId, userId, storeId, accessToken, sinceDate } = params

  let page = 1
  let imported = 0

  while (true) {
    const payload = await listYouCanOrders({ accessToken, page })
    const orders = payload.data || []

    for (const order of orders) {
      const result = await upsertYouCanOrderFromPayload({
        supabase,
        integrationId,
        userId,
        storeId,
        order,
        sinceDate,
      })
      if (!result.skipped) imported += 1
    }

    const totalPages = Number(payload.meta?.pagination?.total_pages || 1)
    if (page >= totalPages) break
    page += 1
  }

  return imported
}
