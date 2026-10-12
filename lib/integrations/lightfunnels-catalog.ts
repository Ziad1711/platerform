import {
  countLightfunnelsAccountStores,
  listLightfunnelsProducts,
} from '@/lib/integrations/lightfunnels'
import {
  findExistingProduct,
  findProductFallbackVariant,
  findVariantBySku,
  readMappingInternalId,
  storeEntityMapping,
  type LightfunnelsStoreBinding,
} from '@/lib/integrations/lightfunnels-sync'
import { detectStockMultiplier } from '@/lib/integrations/variant-stock'
import { buildUniqueProductSlug } from '@/lib/products/slug'

type SupabaseLike = any

export type LightfunnelsProductImportSummary = {
  ok: boolean
  reason?: string
  scanned: number
  productsCreated: number
  productsUpdated: number
  productsMatched: number
  variantsCreated: number
  variantsUpdated: number
  skipped: number
  skippedReasons: Record<string, number>
  hasMore: boolean
  warnings: string[]
}

type NormalizedVariant = {
  externalId: string
  title: string
  sku: string
  price: number
  compareAtPrice: number | null
  optionValues: Record<string, string>
}

type NormalizedProduct = {
  externalId: string
  title: string
  slug: string | null
  description: string | null
  price: number
  compareAtPrice: number | null
  sku: string
  imageUrl: string | null
  /** Boutique distante propriétaire du produit, quand l'API l'expose (`store_id`). */
  storeId: string | null
  variants: NormalizedVariant[]
}

function readText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string' && typeof value !== 'number') continue
    const normalized = String(value).trim()
    if (normalized.length > 0) return normalized
  }

  return null
}

function toAmount(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readVariantOptionValues(variant: any): Record<string, string> {
  const values: Record<string, string> = {}

  if (Array.isArray(variant?.options)) {
    for (const option of variant.options) {
      const id = readText(option?.id)
      const value = readText(option?.value)
      if (id && value) values[id] = value
    }
  }

  return values
}

/** Lecture tolérante d'un produit du catalogue (champs documentés uniquement). */
export function readLightfunnelsProduct(product: any): NormalizedProduct | null {
  const externalId = readText(product?.id)
  if (!externalId) return null

  const variants: NormalizedVariant[] = []

  for (const variant of Array.isArray(product?.variants) ? product.variants : []) {
    const variantId = readText(variant?.id)
    if (!variantId) continue

    variants.push({
      externalId: variantId,
      title: readText(variant?.title) || readText(product?.title) || 'Variante',
      sku: readText(variant?.sku) || '',
      price: toAmount(variant?.price) ?? toAmount(product?.price) ?? 0,
      compareAtPrice: toAmount(variant?.compare_at_price),
      optionValues: readVariantOptionValues(variant),
    })
  }

  return {
    externalId,
    title: readText(product?.title) || 'Produit Lightfunnels',
    slug: readText(product?.slug),
    description: readText(product?.description),
    price: toAmount(product?.price) ?? 0,
    compareAtPrice: toAmount(product?.compare_at_price),
    sku: readText(product?.sku) || '',
    imageUrl: readText(product?.thumbnail?.path),
    // La boutique vient de la relation documentée `stores` ; les anciens champs sont acceptés
    // en repli si une version de l'API les expose encore.
    storeId: readText(product?.stores?.[0]?.id, product?.store_id, product?.store?.id),
    variants,
  }
}

function toShortDescription(description: string | null): string | null {
  if (!description) return null
  const plain = description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!plain) return null
  return plain.length > 180 ? `${plain.slice(0, 177)}...` : plain
}

/**
 * Synchronise les variantes d'un produit.
 *
 * Une variante déjà liée est mise à jour (libellé, SKU, prix, ancien prix, options) ; une
 * variante inconnue mais dont le SKU existe déjà dans le store est seulement liée (aucun
 * écrasement) ; sinon elle est créée. Le stock et le coût d'achat ne sont jamais touchés.
 */
async function syncProductVariants(params: {
  supabase: SupabaseLike
  integrationId: string
  userId: string
  storeId: string
  productId: string
  product: NormalizedProduct
}) {
  const { supabase, integrationId, userId, storeId, productId, product } = params
  let variantsCreated = 0
  let variantsUpdated = 0

  if (product.variants.length === 0) {
    // Un produit sans variante chez la source garde une variante par défaut dans Jisra :
    // les lignes de commande s'appuient sur `product_variants`.
    const fallback = await findProductFallbackVariant({ supabase, productId })

    if (!fallback) {
      const { error } = await supabase.from('product_variants').insert({
        store_id: storeId,
        product_id: productId,
        name: product.title,
        sku: product.sku || `lightfunnels:${product.externalId}`,
        selling_price: product.price,
        purchase_cost: 0,
        option_values: {},
        old_price: product.compareAtPrice,
        is_default: true,
        sort_order: 0,
        stock_multiplier: detectStockMultiplier({ name: product.title }),
      })

      if (error) throw error
      variantsCreated += 1
    }

    return { variantsCreated, variantsUpdated }
  }

  for (const [index, variant] of product.variants.entries()) {
    const optionValues = variant.optionValues
    const optionLabel = Object.values(optionValues).filter(Boolean).join(' / ')
    const variantName = optionLabel ? `${product.title} — ${optionLabel}` : variant.title
    const stockMultiplier = detectStockMultiplier({ name: variantName, optionValues })

    const mappedVariantId = await readMappingInternalId({
      supabase,
      integrationId,
      entityType: 'variant',
      lightfunnelsId: variant.externalId,
    })

    if (mappedVariantId) {
      const { data: existing, error: existingError } = await supabase
        .from('product_variants')
        .select('id')
        .eq('id', mappedVariantId)
        .eq('store_id', storeId)
        .maybeSingle()

      if (existingError) throw existingError

      if (existing?.id) {
        const { error: variantUpdateError } = await supabase
          .from('product_variants')
          .update({
            name: variantName,
            sku: variant.sku || `lightfunnels:${variant.externalId}`,
            selling_price: variant.price,
            old_price: variant.compareAtPrice,
            option_values: optionValues,
            stock_multiplier: stockMultiplier,
            updated_at: new Date().toISOString(),
          })
          .eq('id', mappedVariantId)
          .eq('store_id', storeId)

        // Une mise à jour rejetée doit être remontée : sinon la variante serait annoncée
        // comme rafraîchie alors qu'elle ne l'est pas.
        if (variantUpdateError) throw variantUpdateError

        variantsUpdated += 1
        continue
      }
    }

    const existingBySku = variant.sku
      ? await findVariantBySku({ supabase, storeId, sku: variant.sku })
      : null

    if (existingBySku && existingBySku.productId === productId) {
      await storeEntityMapping({
        supabase,
        userId,
        integrationId,
        storeId,
        entityType: 'variant',
        lightfunnelsId: variant.externalId,
        internalId: existingBySku.variantId,
      })

      continue
    }

    const { data: inserted, error } = await supabase
      .from('product_variants')
      .insert({
        store_id: storeId,
        product_id: productId,
        name: variantName,
        sku: variant.sku || `lightfunnels:${variant.externalId}`,
        selling_price: variant.price,
        purchase_cost: 0,
        option_values: optionValues,
        old_price: variant.compareAtPrice,
        is_default: index === 0,
        sort_order: index,
        stock_multiplier: stockMultiplier,
      })
      .select('id')
      .single()

    if (error) throw error

    await storeEntityMapping({
      supabase,
      userId,
      integrationId,
      storeId,
      entityType: 'variant',
      lightfunnelsId: variant.externalId,
      internalId: String(inserted.id),
    })

    variantsCreated += 1
  }

  return { variantsCreated, variantsUpdated }
}

/**
 * Enregistre un produit du catalogue.
 *
 * - produit déjà lié : les champs issus de la source sont rafraîchis (nom, prix, ancien prix,
 *   SKU, description) ; le coût d'achat, le stock et le statut de publication sont intacts ;
 * - produit jamais lié mais SKU identique dans le store : il est seulement **lié**, sans
 *   écrasement (le produit appartient au marchand) ;
 * - sinon : création depuis la source.
 */
async function upsertProductFromLightfunnels(params: {
  supabase: SupabaseLike
  integrationId: string
  userId: string
  storeId: string
  product: NormalizedProduct
}) {
  const { supabase, integrationId, userId, storeId, product } = params

  const mappedProductId = await readMappingInternalId({
    supabase,
    integrationId,
    entityType: 'product',
    lightfunnelsId: product.externalId,
  })

  const linked = await findExistingProduct({ supabase, storeId, productId: mappedProductId })

  if (linked) {
    const { error: productUpdateError } = await supabase
      .from('products')
      .update({
        name: product.title,
        default_selling_price: product.price,
        old_price: product.compareAtPrice,
        ...(product.sku ? { sku: product.sku } : {}),
        ...(product.description ? { description: product.description } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', linked)
      .eq('store_id', storeId)

    if (productUpdateError) throw productUpdateError

    const variants = await syncProductVariants({
      supabase,
      integrationId,
      userId,
      storeId,
      productId: linked,
      product,
    })

    return { created: false, updated: true, matched: false, ...variants }
  }

  const existingBySku = await findExistingProduct({ supabase, storeId, sku: product.sku })

  if (existingBySku) {
    await storeEntityMapping({
      supabase,
      userId,
      integrationId,
      storeId,
      entityType: 'product',
      lightfunnelsId: product.externalId,
      internalId: existingBySku,
    })

    const variants = await syncProductVariants({
      supabase,
      integrationId,
      userId,
      storeId,
      productId: existingBySku,
      product,
    })

    return { created: false, updated: false, matched: true, ...variants }
  }

  const slug = await buildUniqueProductSlug({
    supabase,
    storeId,
    base: product.slug || product.title,
  })

  const { data: inserted, error } = await supabase
    .from('products')
    .insert({
      store_id: storeId,
      name: product.title,
      slug,
      sku: product.sku || null,
      default_selling_price: product.price,
      default_purchase_cost: 0,
      old_price: product.compareAtPrice,
      description: product.description,
      short_description: toShortDescription(product.description),
      image_url: product.imageUrl,
    })
    .select('id')
    .single()

  if (error) throw error
  const productId = String(inserted.id)

  await storeEntityMapping({
    supabase,
    userId,
    integrationId,
    storeId,
    entityType: 'product',
    lightfunnelsId: product.externalId,
    internalId: productId,
  })

  const variants = await syncProductVariants({
    supabase,
    integrationId,
    userId,
    storeId,
    productId,
    product,
  })

  return { created: true, updated: false, matched: false, ...variants }
}

/**
 * Synchronisation du catalogue d'une boutique liée.
 *
 * Les produits déjà liés sont reconnus par leur mapping (donc jamais dupliqués) et
 * rafraîchis. La progression est conservée par boutique (`products_cursor` /
 * `products_has_more`) : un catalogue plus grand qu'une exécution est poursuivi à la
 * relance au lieu de repartir systématiquement de la première page.
 *
 * La boutique distante de chaque produit est vérifiée quand la source l'expose : un produit
 * appartenant à une autre boutique du même compte n'est jamais importé ici. Si la boutique
 * n'est pas exposée et que plusieurs boutiques sont liées, l'import est refusé plutôt que
 * mélangé.
 */
export async function importLightfunnelsProducts(params: {
  supabase: SupabaseLike
  integrationId: string
  userId: string
  binding: LightfunnelsStoreBinding
  accessToken: string
  maxPages?: number
  pageSize?: number
}): Promise<LightfunnelsProductImportSummary> {
  const { supabase, integrationId, userId, binding, accessToken } = params
  const maxPages = Math.max(1, params.maxPages ?? 10)
  const pageSize = Math.min(Math.max(params.pageSize ?? 25, 1), 50)

  const warnings: string[] = []
  const skippedReasons: Record<string, number> = {}
  let scanned = 0
  let productsCreated = 0
  let productsUpdated = 0
  let productsMatched = 0
  let variantsCreated = 0
  let variantsUpdated = 0
  let skipped = 0
  let progressFailed = false
  let cursor: string | null = binding.products_has_more ? binding.products_cursor ?? null : null
  let hasMore = binding.products_has_more ?? true
  let pages = 0

  // Nombre de boutiques du **compte distant**, résolu à la demande : c'est lui qui prouve
  // qu'un produit sans `store_id` est sans ambiguïté (le nombre de liaisons Jisra ne le
  // prouve pas).
  let remoteStoreCount: number | null | undefined

  const isRemoteStoreSingle = async (): Promise<boolean> => {
    if (remoteStoreCount === undefined) {
      remoteStoreCount = await countLightfunnelsAccountStores({ accessToken })
    }

    return remoteStoreCount === 1
  }

  // La progression est enregistrée à chaque page : une coupure ne fait pas repartir de zéro
  // et une défaillance d'enregistrement n'est jamais silencieuse.
  const persistProgress = async (): Promise<boolean> => {
    const { error: persistError } = await supabase
      .from('lightfunnels_store_bindings')
      .update({
        products_cursor: cursor,
        products_has_more: hasMore,
        last_products_at: new Date().toISOString(),
        last_products_scanned: scanned,
        last_products_created: productsCreated,
        last_products_updated: productsUpdated,
        last_products_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', binding.id)

    if (persistError) {
      console.error('[lightfunnels][catalog] progress not saved', {
        bindingId: binding.id,
        error: persistError.message,
      })

      const warning = `CATALOG_PROGRESS_NOT_SAVED:${persistError.message}`
      if (!warnings.includes(warning)) warnings.push(warning)

      return false
    }

    return true
  }

  // L'échec est conservé sur la liaison : il reste visible dans l'assistant au lieu de
  // disparaître avec la réponse HTTP.
  const fail = async (reason: string): Promise<LightfunnelsProductImportSummary> => {
    const { error: errorPersist } = await supabase
      .from('lightfunnels_store_bindings')
      .update({ last_products_error: reason, updated_at: new Date().toISOString() })
      .eq('id', binding.id)

    if (errorPersist) {
      console.error('[lightfunnels][catalog] error not saved', {
        bindingId: binding.id,
        error: errorPersist.message,
      })
    }

    return {
      ok: false,
      reason,
      scanned,
      productsCreated,
      productsUpdated,
      productsMatched,
      variantsCreated,
      variantsUpdated,
      skipped,
      skippedReasons,
      hasMore,
      warnings,
    }
  }

  try {

    while (pages < maxPages) {
      const page = await listLightfunnelsProducts({ accessToken, first: pageSize, after: cursor })
      pages += 1

      for (const warning of page.warnings) {
        if (!warnings.includes(warning)) warnings.push(warning)
      }

      // Sans boutique lisible pour le produit, l'unicité doit être prouvée sur le **compte
      // distant** : sinon l'import est refusé au lieu de mélanger les catalogues.
      if (!page.storeIdAvailable && !(await isRemoteStoreSingle())) {
        return await fail('STORE_ID_NOT_QUERYABLE')
      }

      if (page.products.length === 0) {
        hasMore = false
        cursor = null
        if (!(await persistProgress())) progressFailed = true
        break
      }

      for (const raw of page.products) {
        const product = readLightfunnelsProduct(raw)
        scanned += 1

        if (!product) continue

        // La boutique distante est vérifiée dès que la source l'expose : le produit d'une
        // autre boutique du même compte n'entre jamais dans ce store. Si la source ne
        // l'expose pas, l'import a déjà été refusé plus haut (STORE_ID_NOT_QUERYABLE) sauf
        // unicité prouvée du compte distant : il n'y a alors aucune ambiguïté.
        if (product.storeId && binding.lightfunnels_store_id && product.storeId !== binding.lightfunnels_store_id) {
          skipped += 1
          skippedReasons['OTHER_STORE'] = (skippedReasons['OTHER_STORE'] || 0) + 1
          continue
        }

        const outcome = await upsertProductFromLightfunnels({
          supabase,
          integrationId,
          userId,
          storeId: binding.store_id,
          product,
        })

        if (outcome.created) productsCreated += 1
        else if (outcome.updated) productsUpdated += 1
        else if (outcome.matched) productsMatched += 1

        variantsCreated += outcome.variantsCreated
        variantsUpdated += outcome.variantsUpdated
      }

      cursor = page.endCursor
      hasMore = page.hasNextPage

      if (!page.hasNextPage) {
        hasMore = false
        cursor = null
        if (!(await persistProgress())) progressFailed = true
        break
      }

      // Progression enregistrée page par page : sans curseur enregistré, la reprise
      // annoncée n'existe pas — l'import s'arrête et le signale.
      if (!(await persistProgress())) {
        progressFailed = true
        hasMore = true
        break
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'LIGHTFUNNELS_PRODUCTS_FAILED'
    console.error('[lightfunnels][catalog] failed', { bindingId: binding.id, message })

    // La position atteinte est conservée avant de signaler l'échec : la relance reprend à
    // cette page plutôt qu'au début.
    await persistProgress()
    return await fail(message)
  }

  return {
    ok: !progressFailed,
    ...(progressFailed ? { reason: 'CATALOG_PROGRESS_NOT_SAVED' } : {}),
    scanned,
    productsCreated,
    productsUpdated,
    productsMatched,
    variantsCreated,
    variantsUpdated,
    skipped,
    skippedReasons,
    hasMore,
    warnings,
  }
}



