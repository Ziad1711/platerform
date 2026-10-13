import {
  LIGHTFUNNELS_PROVIDER,
  countLightfunnelsAccountStores,
  getLightfunnelsConfig,
  getLightfunnelsOrder,
  isLightfunnelsTestOrder,
  listLightfunnelsOrders,
  parseLightfunnelsDate,
  readLightfunnelsAddress,
  readLightfunnelsOrderLines,
  isLightfunnelsRateLimitError,
  refreshLightfunnelsToken,
  type LightfunnelsOrderLine,
} from '@/lib/integrations/lightfunnels'
import {
  applyOrderTotalRounding,
  isStoreOrderTotalRoundingEnabled,
} from '@/lib/integrations/order-total-rounding'
import { detectStockMultiplier } from '@/lib/integrations/variant-stock'
import { buildUniqueProductSlug } from '@/lib/products/slug'
import { decryptSecret, encryptSecret } from '@/lib/security/crypto'
import { normalizeMoroccanPhone } from '@/lib/utils'
import { quotaCodeFromMessage, describeQuotaError } from '@/lib/billing/quota'

type SupabaseLike = any

/** Date plancher de l'import initial, alignée sur l'import YouCan. */
export const LIGHTFUNNELS_DEFAULT_SINCE_DATE = '2026-01-01'
const ACCESS_TOKEN_SAFETY_WINDOW_MS = 5 * 60 * 1000
/**
 * Attente minimale entre deux lectures de détail de commande. Lightfunnels a répondu `429`
 * (« rate limit ») en plein import de 25 commandes : l'espacement évite de gaspiller le quota
 * du compte et de repartir d'une reprise inutile.
 */
const ORDER_DETAIL_THROTTLE_MS = 250

export type LightfunnelsOrderImportResult = {
  status: 'created' | 'already_imported' | 'skipped' | 'rejected'
  reason?: string
  errorMessage?: string
  orderId?: string | null
  reconciled?: boolean
  /** Alertes non bloquantes à remonter à l'appelant (jamais de secret). */
  warnings?: string[]
}

function tokenExpiryFrom(expiresIn: unknown): string | null {
  const seconds = Number(expiresIn)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(Date.now() + seconds * 1000).toISOString()
}

/**
 * Résout un accès utilisable : le jeton est déchiffré puis rafraîchi s'il approche de
 * l'expiration (validité 2 h). Chaque rafraîchissement renvoie un nouveau refresh token :
 * le nouveau couple est toujours réenregistré, l'ancien devient inutilisable.
 */
export async function resolveLightfunnelsAccessToken(params: {
  supabase: SupabaseLike
  integrationId: string
}) {
  const { supabase, integrationId } = params

  const { data: integration, error } = await supabase
    .from('integrations')
    .select('id, user_id, access_token, refresh_token, token_expires_at, status')
    .eq('id', integrationId)
    .eq('provider', LIGHTFUNNELS_PROVIDER)
    .maybeSingle()

  if (error) throw error
  if (!integration) throw new Error('LIGHTFUNNELS_NOT_CONNECTED')

  const accessToken = decryptSecret(String(integration.access_token || ''))
  if (!accessToken) throw new Error('LIGHTFUNNELS_NOT_CONNECTED')

  const expiry = integration.token_expires_at ? new Date(integration.token_expires_at).getTime() : null
  const isExpired = expiry !== null && Number.isFinite(expiry) && expiry <= Date.now()
  const needsRefresh = expiry !== null && Number.isFinite(expiry) && expiry - Date.now() < ACCESS_TOKEN_SAFETY_WINDOW_MS

  if (!needsRefresh) {
    return { accessToken, integration }
  }

  const config = getLightfunnelsConfig()
  const refreshToken = decryptSecret(String(integration.refresh_token || ''))
  // Valeur chiffrée telle que stockée : référence pour détecter un renouvellement concurrent.
  const storedRefreshToken = String(integration.refresh_token || '')

  if (!config || !refreshToken) {
    if (isExpired) {
      await supabase
        .from('integrations')
        .update({ status: 'error', updated_at: new Date().toISOString() })
        .eq('id', integrationId)
      throw new Error('LIGHTFUNNELS_TOKEN_EXPIRED')
    }

    return { accessToken, integration }
  }

  try {
    const tokens = await refreshLightfunnelsToken({
      refreshToken,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    })

    const nextAccessToken = String(tokens.access_token || '')
    const nextRefreshToken = tokens.refresh_token ? String(tokens.refresh_token) : refreshToken

    // Les jetons sont chiffrés comme au callback, et la sauvegarde est indispensable :
    // Lightfunnels invalide l'ancien refresh token à chaque renouvellement. Le filtre sur
    // l'ancien refresh token évite qu'un renouvellement concurrent n'écrase un jeton déjà
    // tourné par un autre appel.
    const persistPayload = {
      access_token: encryptSecret(nextAccessToken),
      refresh_token: encryptSecret(nextRefreshToken),
      token_expires_at: tokenExpiryFrom(tokens.expires_in),
      status: 'connected',
      updated_at: new Date().toISOString(),
    }

    const { data: persisted, error: persistError } = await supabase
      .from('integrations')
      .update(persistPayload)
      .eq('id', integrationId)
      .eq('refresh_token', storedRefreshToken)
      .select('id')

    if (persistError) {
      // Aucune écriture aveugle de secours : écraser les jetons d'un autre renouvellement
      // rendrait l'installation inutilisable. L'échec est bloquant et remonté tel quel.
      console.error('[lightfunnels][token] persist failed', {
        integrationId,
        error: persistError.message,
      })
      throw new Error('LIGHTFUNNELS_TOKEN_PERSIST_FAILED')
    }

    if (!persisted || persisted.length === 0) {
      // Le refresh token stocké a changé : un autre appel a déjà tourné le jeton, et c'est
      // celui qui est stocké désormais qui est valide.
      const { data: latest } = await supabase
        .from('integrations')
        .select('access_token')
        .eq('id', integrationId)
        .maybeSingle()

      const latestAccessToken = decryptSecret(String(latest?.access_token || ''))

      if (!latestAccessToken) {
        throw new Error('LIGHTFUNNELS_TOKEN_PERSIST_FAILED')
      }

      console.warn('[lightfunnels][token] refreshed elsewhere, using stored token', {
        integrationId,
      })

      return { accessToken: latestAccessToken, integration }
    }

    return { accessToken: nextAccessToken, integration }
  } catch (refreshError) {
    const message = refreshError instanceof Error ? refreshError.message : 'REFRESH_FAILED'
    console.error('[lightfunnels][token] refresh failed', { integrationId, message })

    // Une sauvegarde impossible ne doit jamais être masquée : le jeton frais serait perdu.
    if (message.startsWith('LIGHTFUNNELS_TOKEN_PERSIST_FAILED')) {
      throw refreshError instanceof Error ? refreshError : new Error(message)
    }

    if (isExpired) {
      // Un autre appel a pu renouveler le couple juste avant nous : la valeur stockée est
      // alors valide et ne doit pas être marquée en erreur.
      const { data: latest } = await supabase
        .from('integrations')
        .select('access_token, refresh_token')
        .eq('id', integrationId)
        .maybeSingle()

      const storedRefreshNow = String(latest?.refresh_token || '')
      const latestAccessToken = decryptSecret(String(latest?.access_token || ''))

      if (storedRefreshNow && storedRefreshNow !== storedRefreshToken && latestAccessToken) {
        console.warn('[lightfunnels][token] refreshed concurrently, using stored token', {
          integrationId,
        })

        return { accessToken: latestAccessToken, integration }
      }

      await supabase
        .from('integrations')
        .update({ status: 'error', updated_at: new Date().toISOString() })
        .eq('id', integrationId)
      throw new Error('LIGHTFUNNELS_TOKEN_EXPIRED')
    }

    // Le jeton courant reste valable quelques minutes : on continue avec lui.
    return { accessToken, integration }
  }
}

export async function readMappingInternalId(params: {
  supabase: SupabaseLike
  integrationId: string
  entityType: 'order' | 'product' | 'variant'
  lightfunnelsId: string
}) {
  const { supabase, integrationId, entityType, lightfunnelsId } = params
  if (!lightfunnelsId) return null

  const { data, error } = await supabase
    .from('lightfunnels_entity_mappings')
    .select('internal_id')
    .eq('integration_id', integrationId)
    .eq('entity_type', entityType)
    .eq('lightfunnels_id', lightfunnelsId)
    .maybeSingle()

  // Une lecture ratée doit faire échouer l'import : l'ignorer reviendrait à traiter une
  // entité déjà liée comme une nouveauté (doublons de produits ou de commandes).
  if (error) throw error

  return data?.internal_id ? String(data.internal_id) : null
}

/**
 * État d'une commande distante au regard de sa liaison locale.
 *
 *   * `none`        : aucune liaison connue, la commande est à importer ;
 *   * `verified`    : la liaison pointe une commande **existante du store cible** — le seul cas
 *                     où la commande est considérée comme réellement présente dans Ventes ;
 *   * `orphan`      : la liaison pointe une commande disparue (vente supprimée sans que la
 *                     liaison le soit) — la commande doit être **réimportée**, jamais comptée
 *                     « déjà présente » ;
 *   * `other_store` : la liaison appartient à un **autre store** (boutique distante rattachée
 *                     ailleurs) : la vente existante n'est ni déplacée ni réécrite et aucun
 *                     doublon n'est créé — la commande est signalée « à réparer ».
 */
export type LightfunnelsOrderMappingState = 'none' | 'verified' | 'orphan' | 'other_store'

const ORDER_MAPPING_STATES: LightfunnelsOrderMappingState[] = [
  'none',
  'verified',
  'orphan',
  'other_store',
]

/**
 * La seule présence d'une liaison ne prouve pas qu'une commande a été importée : elle doit
 * pointer une commande **existante du store lié**. Un mapping orphelin (vente supprimée dans
 * Ventes) bloquait toute reprise — la commande restait « déjà présente » sans exister.
 *
 * L'état est calculé en base par `lightfunnels_order_mapping_state` : une lecture côté client ne
 * peut pas distinguer une commande supprimée d'une commande appartenant à un autre store, la RLS
 * masquant les deux de la même façon.
 */
export async function inspectLightfunnelsOrderMapping(params: {
  supabase: SupabaseLike
  integrationId: string
  storeId: string
  lightfunnelsOrderId: string
}): Promise<LightfunnelsOrderMappingState> {
  const { data, error } = await params.supabase.rpc('lightfunnels_order_mapping_state', {
    p_integration_id: params.integrationId,
    p_store_id: params.storeId,
    p_external_order_id: params.lightfunnelsOrderId,
  })

  // Une lecture ratée doit faire échouer l'import : la traiter comme « nouvelle » créerait un
  // doublon, la traiter comme « déjà présente » masquerait une commande manquante.
  if (error) throw error

  const state = String(data || '')

  // Un état inconnu (fonction absente ou évolution non déployée) doit faire échouer l'import :
  // le traduire en « à importer » créerait un doublon, en « déjà présente » masquerait une
  // commande manquante.
  if (!ORDER_MAPPING_STATES.includes(state as LightfunnelsOrderMappingState)) {
    throw new Error(`LIGHTFUNNELS_MAPPING_STATE_UNKNOWN:${state || 'EMPTY'}`)
  }

  return state as LightfunnelsOrderMappingState
}

export async function storeEntityMapping(params: {
  supabase: SupabaseLike
  userId: string
  integrationId: string
  storeId: string
  entityType: 'product' | 'variant'
  lightfunnelsId: string
  internalId: string
  payload?: unknown
}) {
  const { supabase, userId, integrationId, storeId, entityType, lightfunnelsId, internalId, payload } = params
  if (!lightfunnelsId) return

  const { error } = await supabase
    .from('lightfunnels_entity_mappings')
    .upsert(
      {
        user_id: userId,
        integration_id: integrationId,
        store_id: storeId,
        entity_type: entityType,
        lightfunnels_id: lightfunnelsId,
        internal_id: internalId,
        payload: payload ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'integration_id,entity_type,lightfunnels_id' }
    )

  // Un mapping non enregistré fait retomber la prochaine exécution sur une création :
  // l'échec est donc remonté au lieu d'être ignoré.
  if (error) throw error
}

export async function findExistingProduct(params: {
  supabase: SupabaseLike
  storeId: string
  productId?: string | null
  sku?: string
}) {
  const { supabase, storeId, productId, sku } = params

  if (productId) {
    const { data, error } = await supabase
      .from('products')
      .select('id')
      .eq('id', productId)
      .eq('store_id', storeId)
      .maybeSingle()

    if (error) throw error

    if (data?.id) return String(data.id)
  }

  const normalizedSku = String(sku || '').trim()
  if (!normalizedSku) return null

  const { data, error } = await supabase
    .from('products')
    .select('id')
    .eq('store_id', storeId)
    .eq('sku', normalizedSku)
    .limit(1)

  if (error) throw error

  return data?.[0]?.id ? String(data[0].id) : null
}

export async function findVariantBySku(params: { supabase: SupabaseLike; storeId: string; sku: string }) {
  const { supabase, storeId, sku } = params
  const normalizedSku = String(sku || '').trim()
  if (!normalizedSku) return null

  const { data, error } = await supabase
    .from('product_variants')
    .select('id, product_id')
    .eq('store_id', storeId)
    .eq('sku', normalizedSku)
    .limit(1)

  if (error) throw error

  const row = data?.[0]
  return row?.id ? { variantId: String(row.id), productId: String(row.product_id) } : null
}

function normalizeTextKey(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Identité externe stable d'une ligne. Un `OrderBumpSnapshot` n'a pas toujours de
 * `product_id` : le repli évite de recréer un produit à chaque commande importée.
 */
export function resolveLightfunnelsLineKey(line: LightfunnelsOrderLine) {
  if (line.productId) return line.productId
  if (line.variantId) return `variant:${line.variantId}`
  if (line.sku) return `sku:${line.sku}`
  return `bump:${normalizeTextKey(line.title)}:${line.unitPrice}`
}

/**
 * Rattache une ligne de commande à un produit / une variante Jisra.
 *
 * Ordre de résolution : mapping variante -> mapping produit -> SKU identique dans le store
 * -> création. La création reprend libellé, SKU et prix de la source ; aucun champ
 * commercial d'un produit existant n'est écrasé. Le prix appliqué reste celui de la ligne
 * de commande, Jisra ne réécrit donc jamais le montant encaissé par la source.
 */
type LightfunnelsLineTarget = {
  productId: string | null
  variantId: string | null
  /** Liaison interne manquante (produit ou variante supprimé) : signalée, jamais masquée. */
  warnings: string[]
}

async function resolveLightfunnelsLineTarget(params: {
  supabase: SupabaseLike
  integrationId: string
  userId: string
  storeId: string
  line: LightfunnelsOrderLine
}): Promise<LightfunnelsLineTarget> {
  const { supabase, integrationId, userId, storeId, line } = params
  const warnings: string[] = []
  const lineKey = resolveLightfunnelsLineKey(line)
  /**
   * Une option réellement choisie par le client. Un `variant_id` Lightfunnels sans option est
   * une variante **technique** : la rattacher créerait une variante Jisra que le client n'a pas
   * choisie (et la ferait apparaître entre parenthèses dans Ventes). Dans ce cas la ligne reste
   * rattachée au produit, `product_variant_id` nul — le suivi de stock gère ce cas.
   */
  const hasCommercialOption = String(line.optionsLabel || '').trim().length > 0
  /**
   * Ligne de variante dont le champ `options` n'a **pas** été lu (palier de requête réduit).
   * Rien ne permet alors de dire si le client a choisi une option : le produit simple et la
   * variante inconnue sont indistinguables. Une telle ligne n'est jamais devinée — la commande
   * est bloquée et relue à la reprise (les bumps n'ont pas d'options : ils sont exclus).
   */
  const variantOptionsUnknown =
    !line.optionsAvailable && line.itemTypeName !== 'OrderBumpSnapshot'
  /**
   * Liaison variante lue dès qu'une option est choisie **ou** que les options sont inconnues :
   * une liaison existante prouve l'identité de la variante et évite tout blocage inutile.
   */
  const mappedVariantId =
    hasCommercialOption || variantOptionsUnknown
      ? await readMappingInternalId({
          supabase,
          integrationId,
          entityType: 'variant',
          lightfunnelsId: line.variantId,
        })
      : null

  if (mappedVariantId) {
    const { data, error } = await supabase
      .from('product_variants')
      .select('id, product_id')
      .eq('id', mappedVariantId)
      .eq('store_id', storeId)
      .maybeSingle()

    if (error) throw error

    if (data?.id) {
      return { productId: String(data.product_id), variantId: String(data.id), warnings }
    }

    // Variante liée mais absente du store cible : la liaison est orpheline, elle sera
    // reconstruite (SKU identique ou création) et l'écart est remonté.
    warnings.push(`MAPPING_VARIANT_MISSING:${line.variantId || lineKey}`)
  }

  const mappedProductId = await readMappingInternalId({
    supabase,
    integrationId,
    entityType: 'product',
    lightfunnelsId: lineKey,
  })

  const existingProductId = await findExistingProduct({
    supabase,
    storeId,
    productId: mappedProductId || line.productId,
    sku: line.sku,
  })

  if (mappedProductId && existingProductId !== mappedProductId) {
    // Produit lié mais introuvable dans le store cible : la liaison sera reconstruite.
    warnings.push(`MAPPING_PRODUCT_MISSING:${lineKey}`)
  }

  const rememberMappings = async (productId: string, variantId: string | null) => {
    await storeEntityMapping({
      supabase,
      userId,
      integrationId,
      storeId,
      entityType: 'product',
      lightfunnelsId: lineKey,
      internalId: productId,
    })

    if (variantId && line.variantId) {
      await storeEntityMapping({
        supabase,
        userId,
        integrationId,
        storeId,
        entityType: 'variant',
        lightfunnelsId: line.variantId,
        internalId: variantId,
      })
    }
  }

  if (existingProductId) {
    if (!hasCommercialOption && !variantOptionsUnknown) {
      // Aucune option (prouvée vide) : la ligne reste rattachée au produit, sans variante
      // inventée.
      await rememberMappings(existingProductId, null)
      return { productId: existingProductId, variantId: null, warnings }
    }

    const skuVariant = await findVariantBySku({ supabase, storeId, sku: line.sku })
    const variantId = skuVariant?.productId === existingProductId ? skuVariant.variantId : null

    if (!variantId && variantOptionsUnknown) {
      // Options non lues et aucune identité de variante établie (liaison absente, SKU inconnu) :
      // la commande est bloquée plutôt que rattachée à une variante devinée ou privée de sa
      // variante. Elle sera relue à la reprise.
      throw new Error(
        `LIGHTFUNNELS_ORDER_LINE_AMBIGUOUS:${line.variantId || line.itemId || lineKey}`
      )
    }

    if (!variantId) {
      // Une option a été choisie mais aucune variante ne peut être identifiée (ni liaison, ni
      // SKU). La variante **par défaut** du produit n'est jamais utilisée comme repli : elle
      // peut correspondre à une autre option. La ligne reste rattachée au produit et l'ambiguïté
      // est visible dans le bilan.
      warnings.push(
        `ORDER_VARIANT_NOT_IDENTIFIED:${line.variantId || line.optionsLabel || lineKey}`
      )
    }

    await rememberMappings(existingProductId, variantId)
    return { productId: existingProductId, variantId, warnings }
  }

  const skuVariant =
    hasCommercialOption || variantOptionsUnknown
      ? await findVariantBySku({ supabase, storeId, sku: line.sku })
      : null

  if (skuVariant) {
    await rememberMappings(skuVariant.productId, skuVariant.variantId)
    return { productId: skuVariant.productId, variantId: skuVariant.variantId, warnings }
  }

  if (variantOptionsUnknown) {
    // Aucun produit ni variante n'existe déjà : créer ici reviendrait à décider à la place du
    // client (produit simple ou variante ?). Rien n'est écrit — la commande est bloquée et
    // relue à la reprise, sans laisser de produit orphelin.
    throw new Error(
      `LIGHTFUNNELS_ORDER_LINE_AMBIGUOUS:${line.variantId || line.itemId || lineKey}`
    )
  }

  const unitPrice = Number.isFinite(line.unitPrice) ? line.unitPrice : 0
  const slug = await buildUniqueProductSlug({ supabase, storeId, base: line.title })

  const { data: insertedProduct, error: productError } = await supabase
    .from('products')
    .insert({
      store_id: storeId,
      name: line.title,
      slug,
      sku: line.sku || null,
      default_selling_price: unitPrice,
      default_purchase_cost: 0,
    })
    .select('id')
    .single()

  if (productError) throw productError
  const productId = String(insertedProduct.id)

  if (!hasCommercialOption) {
    // Produit créé depuis une vente sans option : **aucune** variante. Le client n'a rien
    // choisi, Jisra ne doit donc pas fabriquer un choix (la ligne vise le produit).
    await rememberMappings(productId, null)
    return { productId, variantId: null, warnings }
  }

  const variantName = `${line.title} — ${line.optionsLabel}`
  const variantSku = line.sku || `lightfunnels:${line.variantId || line.itemId || productId}`
  const optionValues = { Option: String(line.optionsLabel) }

  const { data: insertedVariant, error: variantError } = await supabase
    .from('product_variants')
    .insert({
      store_id: storeId,
      product_id: productId,
      name: variantName,
      sku: variantSku,
      selling_price: unitPrice,
      purchase_cost: 0,
      // L'option réellement choisie est conservée : sans elle, la variante serait indistinguable
      // d'une variante technique.
      option_values: optionValues,
      is_default: true,
      sort_order: 0,
      stock_multiplier: detectStockMultiplier({ name: variantName, optionValues }),
    })
    .select('id')
    .single()

  if (variantError) throw variantError
  const variantId = String(insertedVariant.id)

  await rememberMappings(productId, variantId)

  return { productId, variantId, warnings }
}

export type LightfunnelsStoreBinding = {
  id: string
  integration_id: string
  user_id: string
  store_id: string
  lightfunnels_store_id: string
  lightfunnels_account_id?: string | null
  import_cursor: string | null
  has_more: boolean
  products_cursor?: string | null
  products_has_more?: boolean
}

/**
 * Importe une commande Lightfunnels — création seule : une commande déjà liée n'est jamais
 * réécrite. Les cas hors périmètre sont refusés explicitement plutôt qu'importés
 * approximativement : commande de test, hors date plancher, devise différente du store,
 * commande d'une autre boutique distante.
 */
export async function upsertLightfunnelsOrderFromPayload(params: {
  supabase: SupabaseLike
  integrationId: string
  userId: string
  binding: LightfunnelsStoreBinding
  order: any
  sinceDate?: string | null
  roundOrderTotal?: boolean
  storeCurrency?: string | null
  /**
   * Autorise l'absence de `store_id` dans le payload **uniquement** lorsque le compte ne
   * possède qu'une seule boutique liée (cas webhook : la liaison est alors identifiée par
   * l'URL). Par défaut, une commande dont la boutique n'est pas prouvée est refusée.
   */
  allowMissingStoreId?: boolean
}): Promise<LightfunnelsOrderImportResult> {
  const { supabase, integrationId, userId, binding, order } = params
  const storeId = binding.store_id
  const externalOrderId = String(order?.id || '').trim()

  if (!externalOrderId) return { status: 'skipped', reason: 'MISSING_ORDER_ID' }

  // La date de la commande vient de `date` (champ documenté) puis, en repli, de `created_at`.
  // Lightfunnels peut renvoyer ces champs en **relatif** (« 7 months ago ») : dans ce cas la
  // date n'est pas résoluble et la commande est bloquée plus bas au lieu d'être datée du jour.
  const orderDate =
    parseLightfunnelsDate(order?.date) ?? parseLightfunnelsDate(order?.created_at)
  const since = params.sinceDate ? parseLightfunnelsDate(String(params.sinceDate)) : null

  if (since && orderDate && orderDate < since) {
    return { status: 'skipped', reason: 'BEFORE_SINCE_DATE' }
  }

  if (isLightfunnelsTestOrder(order)) {
    return { status: 'skipped', reason: 'TEST_ORDER' }
  }

  // La boutique distante doit être prouvée : une commande sans `store_id` n'est acceptée
  // que si le compte ne possède qu'une seule boutique liée (sinon elle pourrait appartenir
  // à une autre boutique du même compte).
  const remoteStoreId = String(order?.store_id || '').trim()

  if (!remoteStoreId) {
    if (!params.allowMissingStoreId) {
      return { status: 'skipped', reason: 'MISSING_REMOTE_STORE' }
    }
  } else if (binding.lightfunnels_store_id && remoteStoreId !== binding.lightfunnels_store_id) {
    return { status: 'skipped', reason: 'STORE_MISMATCH' }
  }

  const currency = String(order?.currency || '').trim().toUpperCase()
  const expectedCurrency = String(params.storeCurrency || '').trim().toUpperCase()
  if (currency && expectedCurrency && currency !== expectedCurrency) {
    return { status: 'skipped', reason: 'CURRENCY_MISMATCH' }
  }

  const lines = readLightfunnelsOrderLines(order)
  if (lines.length === 0) return { status: 'skipped', reason: 'NO_ITEMS' }

  const remoteTotal = Number(order?.total || 0)
  const shipping = Math.max(Number(order?.shipping || 0) || 0, 0)
  const roundOrderTotal =
    params.roundOrderTotal ?? (await isStoreOrderTotalRoundingEnabled(storeId, supabase))
  const rounded = applyOrderTotalRounding(Number.isFinite(remoteTotal) ? remoteTotal : 0, roundOrderTotal)

  // Un snapshot Lightfunnels = une unité : les lignes identiques sont regroupées en quantité.
  const warnings: string[] = []
  const grouped = new Map<
    string,
    {
      product_id: string
      product_variant_id: string | null
      quantity: number
      unit_selling_price: number
    }
  >()

  for (const line of lines) {
    const resolved = await resolveLightfunnelsLineTarget({
      supabase,
      integrationId,
      userId,
      storeId,
      line,
    })

    for (const warning of resolved.warnings) {
      if (!warnings.includes(warning)) warnings.push(warning)
    }

    if (!resolved.productId) continue

    const unitPrice = Number.isFinite(line.unitPrice) ? line.unitPrice : 0
    const key = `${resolved.productId}|${resolved.variantId || ''}|${unitPrice}`
    const existing = grouped.get(key)

    if (existing) {
      existing.quantity += 1
      continue
    }

    grouped.set(key, {
      product_id: resolved.productId,
      product_variant_id: resolved.variantId,
      quantity: 1,
      unit_selling_price: unitPrice,
    })
  }

  const items = Array.from(grouped.values())
  if (items.length === 0) return { status: 'skipped', reason: 'NO_ITEMS' }

  const address = readLightfunnelsAddress(order)

  // Une date de commande non résoluble (Lightfunnels peut renvoyer `date`/`created_at` en
  // relatif : « 7 months ago ») ne doit **jamais** produire une vente datée d'aujourd'hui : la
  // commande est bloquée et sera relue à la reprise, comme toute donnée non devinable.
  if (!orderDate) {
    throw new Error(`LIGHTFUNNELS_ORDER_DATE_UNRESOLVABLE:${externalOrderId}`)
  }

  // Contrôle de l'hypothèse « un snapshot = une unité » : le sous-total annoncé par
  // Lightfunnels doit correspondre à la somme des lignes reconstituées. Un écart signale
  // que la quantité réelle n'est pas représentable (l'import reste fait, l'écart est visible
  // et absorbé par la remise calculée côté RPC).
  const remoteSubtotal = Number(order?.subtotal)
  const computedSubtotal = items.reduce(
    (total, item) => total + item.quantity * item.unit_selling_price,
    0
  )

  if (Number.isFinite(remoteSubtotal) && Math.abs(remoteSubtotal - computedSubtotal) > 0.01) {
    warnings.push(`LINES_SUBTOTAL_MISMATCH:${remoteSubtotal}:${computedSubtotal}`)
    console.warn('[lightfunnels][order] lines subtotal diverging from source', {
      integrationId,
      storeId,
      externalOrderId,
      remoteSubtotal,
      computedSubtotal,
    })
  }

  const { data, error } = await supabase.rpc('rpc_import_lightfunnels_order', {
    p_integration_id: integrationId,
    p_user_id: userId,
    p_store_id: storeId,
    // La boutique distante de la liaison : la RPC exige une liaison réelle.
    p_lightfunnels_store_id: String(binding.lightfunnels_store_id || ''),
    p_external_order_id: externalOrderId,
    p_order: {
      customer_name: address.name,
      phone: normalizeMoroccanPhone(address.phone),
      address: address.address,
      city: address.city,
      order_date: orderDate.toISOString(),
      total_selling_price: rounded.total,
      delivery_charge_to_customer: shipping,
      rounding_adjustment: rounded.adjustment,
      source: 'organic',
    },
    p_items: items,
    p_payload: order,
    p_external: {
      financial_status: order?.financial_status ?? null,
      fulfillment_status: order?.fulfillment_status ?? null,
      cancelled_at: order?.cancelled_at ?? null,
    },
  })

  if (error) {
    const quotaCode = quotaCodeFromMessage(error.message)
    if (quotaCode) {
      return {
        status: 'rejected',
        reason: quotaCode,
        errorMessage: describeQuotaError(error.message) || error.message,
      }
    }

    throw error
  }

  const result = (data || {}) as {
    status?: string
    order_id?: string | null
    reconciled?: boolean
    error?: string
  }

  if (result.status === 'already_imported') {
    return { status: 'already_imported', orderId: result.order_id ?? null }
  }

  if (result.status === 'created') {
    if (result.reconciled === false) {
      console.warn('[lightfunnels][order] total diverging from source', {
        integrationId,
        storeId,
        externalOrderId,
        orderId: result.order_id,
      })
    }

    return {
      status: 'created',
      orderId: result.order_id ?? null,
      reconciled: result.reconciled !== false,
      warnings,
    }
  }

  return { status: 'rejected', reason: result.error || 'IMPORT_REJECTED', warnings }
}

export type LightfunnelsImportSummary = {
  ok: boolean
  reason?: string
  scanned: number
  imported: number
  alreadyImported: number
  /**
   * Commandes dont la liaison ne peut pas être confirmée (commande appartenant à un autre
   * store) : ni « déjà présentes », ni importables sans collision — à réparer.
   */
  needsRepair: number
  skipped: number
  skippedReasons: Record<string, number>
  warnings: string[]
  hasMore: boolean
  cursor: string | null
}

/**
 * Import / rattrapage des commandes d'une boutique liée.
 *
 * Fonctionnement : parcours des commandes les plus récentes vers les plus anciennes
 * (`order_by:id order_dir:desc`), arrêt dès la date plancher ou dès qu'une page ne contient
 * plus aucune nouveauté — la reprise après interruption utilise le curseur enregistré,
 * `has_more` indiquant qu'il reste des pages à parcourir.
 */
export async function importLightfunnelsOrders(params: {
  supabase: SupabaseLike
  integrationId: string
  userId: string
  binding: LightfunnelsStoreBinding
  accessToken: string
  sinceDate?: string | null
  maxPages?: number
  pageSize?: number
}): Promise<LightfunnelsImportSummary> {
  const { supabase, integrationId, userId, binding, accessToken } = params
  const maxPages = Math.max(1, params.maxPages ?? 10)
  // Page plus courte depuis la limitation de débit constatée chez Lightfunnels (429 en plein
  // import) : moins de commandes par lot, donc moins de lectures de détail en rafale, et une
  // progression visible plus souvent.
  const pageSize = Math.min(Math.max(params.pageSize ?? 10, 1), 50)
  const sinceDate = params.sinceDate || LIGHTFUNNELS_DEFAULT_SINCE_DATE

  const warnings: string[] = []
  const skippedReasons: Record<string, number> = {}
  let scanned = 0
  let imported = 0
  let alreadyImported = 0
  let skipped = 0
  /** Liaisons incohérentes (commande d'un autre store) : jamais « déjà présente ». */
  let needsRepair = 0
  /** Liaisons orphelines réparées (vente supprimée) : commandes réellement recréées. */
  let repairedOrphans = 0
  let progressFailed = false

  const { data: storeRow } = await supabase
    .from('stores')
    .select('currency')
    .eq('id', binding.store_id)
    .maybeSingle()

  const storeCurrency = (storeRow as { currency?: string | null } | null)?.currency ?? null
  const roundOrderTotal = await isStoreOrderTotalRoundingEnabled(binding.store_id, supabase)

  // Nombre de boutiques du **compte distant**, résolu à la demande et une seule fois : c'est
  // lui qui prouve qu'une commande sans `store_id` est sans ambiguïté. Une seule liaison
  // côté Jisra ne le prouve pas (le compte peut avoir d'autres boutiques non liées).
  let remoteStoreCount: number | null | undefined

  const isRemoteStoreSingle = async (): Promise<boolean> => {
    if (remoteStoreCount === undefined) {
      remoteStoreCount = await countLightfunnelsAccountStores({ accessToken })
    }

    return remoteStoreCount === 1
  }

  let cursor: string | null = binding.has_more ? binding.import_cursor : null
  let hasMore = binding.has_more
  let pages = 0
  /** Échec bloquant (lecture de page ou limitation de débit) : remonté tel quel. */
  let failureReason: string | null = null

  /**
   * Espacement des lectures de détail : le fournisseur limite le débit (429 constaté en plein
   * import) et un import interrompu coûte plus cher qu'une attente de quelques centièmes de
   * seconde par commande. Les commandes déjà vérifiées ne font aucun appel : l'attente n'est
   * appliquée qu'avant une requête réelle.
   */
  let lastDetailRequestAt = 0

  const throttleOrderDetail = async () => {
    const elapsed = Date.now() - lastDetailRequestAt

    if (lastDetailRequestAt > 0 && elapsed < ORDER_DETAIL_THROTTLE_MS) {
      await new Promise((resolve) => setTimeout(resolve, ORDER_DETAIL_THROTTLE_MS - elapsed))
    }

    lastDetailRequestAt = Date.now()
  }

  // La progression est enregistrée à chaque page : une coupure ne fait pas repartir de zéro
  // et une défaillance d'enregistrement n'est jamais silencieuse. Un échec est conservé sur la
  // liaison (`last_import_error`) pour rester visible dans l'assistant.
  const persistImportProgress = async (errorReason: string | null = null): Promise<boolean> => {
    const { error: persistError } = await supabase
      .from('lightfunnels_store_bindings')
      .update({
        import_cursor: cursor,
        has_more: hasMore,
        last_import_at: new Date().toISOString(),
        last_import_scanned: scanned,
        last_import_imported: imported,
        last_import_skipped: skipped,
        last_import_error: errorReason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', binding.id)

    if (persistError) {
      console.error('[lightfunnels][import] progress not saved', {
        bindingId: binding.id,
        error: persistError.message,
      })

      const warning = `IMPORT_PROGRESS_NOT_SAVED:${persistError.message}`
      if (!warnings.includes(warning)) warnings.push(warning)

      return false
    }

    return true
  }

  while (pages < maxPages) {
    // Curseur de début de page : en cas d'échec, la reprise doit repartir d'ici, jamais après.
    const pageStartCursor = cursor

    let page: Awaited<ReturnType<typeof listLightfunnelsOrders>>
    try {
      page = await listLightfunnelsOrders({ accessToken, first: pageSize, after: cursor })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ORDERS_LIST_FAILED'
      cursor = pageStartCursor
      hasMore = true
      failureReason = message
      if (!warnings.includes(message)) warnings.push(message)
      await persistImportProgress(message)
      break
    }

    pages += 1

    for (const warning of page.warnings) {
      if (!warnings.includes(warning)) warnings.push(warning)
    }

    // Sans `store_id` interrogeable, l'unicité doit être prouvée sur le **compte distant** :
    // sinon l'import est refusé au lieu de mélanger silencieusement les boutiques.
    if (!page.storeIdAvailable && !(await isRemoteStoreSingle())) {
      return {
        ok: false,
        reason: 'STORE_ID_NOT_QUERYABLE',
        scanned,
        imported,
        alreadyImported,
        needsRepair,
        skipped,
        skippedReasons,
        warnings,
        hasMore,
        cursor,
      }
    }

    if (page.orders.length === 0) {
      hasMore = false
      cursor = null
      break
    }

    let reachedSinceDate = false
    /** Interruption de page (limitation de débit ou commande bloquante) : reprise au début. */
    let pageAborted = false

    for (const headline of page.orders) {
      const orderId = String(headline?.id || '').trim()
      if (!orderId) continue
      scanned += 1

      // La liaison seule ne prouve rien : elle doit pointer une commande existante **du store
      // lié**. Un mapping orphelin (vente supprimée) est réimporté, un mapping d'un autre store
      // est signalé au lieu d'être compté « déjà présente ».
      const mappingState = await inspectLightfunnelsOrderMapping({
        supabase,
        integrationId,
        storeId: binding.store_id,
        lightfunnelsOrderId: orderId,
      })

      if (mappingState === 'verified') {
        alreadyImported += 1
        continue
      }

      if (mappingState === 'other_store') {
        // La vente existante n'est ni déplacée ni dupliquée : la commande est comptée « à
        // réparer ». Aucun identifiant distant n'est exposé, la quantité suffit au bilan.
        needsRepair += 1
        continue
      }

      /** Liaison orpheline : « réparée » seulement si la commande est réellement recréée. */
      const recoversOrphan = mappingState === 'orphan'

      // Attente avant chaque lecture réelle : les commandes déjà vérifiées ci-dessus n'ont
      // déclenché aucun appel et ne consomment donc pas le quota.
      await throttleOrderDetail()

      let detail: Awaited<ReturnType<typeof getLightfunnelsOrder>>
      try {
        detail = await getLightfunnelsOrder({ accessToken, orderId })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'ORDER_DETAIL_FAILED'

        // La commande n'est jamais sautée : la page est relue depuis son début, sinon une
        // commande non lue serait définitivement dépassée par le curseur et jamais importée.
        failureReason = isLightfunnelsRateLimitError(message)
          ? message
          : `ORDER_DETAIL_BLOCKED:${orderId}:${message}`
        cursor = pageStartCursor
        hasMore = true
        if (!warnings.includes(failureReason)) warnings.push(failureReason)
        await persistImportProgress(failureReason)
        pageAborted = true
        break
      }

      for (const warning of detail.warnings) {
        if (!warnings.includes(warning)) warnings.push(warning)
      }

      if (!detail.addressesAvailable && !warnings.includes('ORDER_ADDRESSES_UNAVAILABLE')) {
        warnings.push('ORDER_ADDRESSES_UNAVAILABLE')
      }

      const result = await (async () => {
        try {
          return await upsertLightfunnelsOrderFromPayload({
            supabase,
            integrationId,
            userId,
            binding,
            order: { ...headline, ...(detail.order || {}) },
            sinceDate,
            roundOrderTotal,
            storeCurrency,
            // L'unicité du compte distant a été prouvée ci-dessus avant de parcourir la page.
            allowMissingStoreId: !page.storeIdAvailable,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'ORDER_UPSERT_FAILED'
          // Écriture bloquante (identité de variante impossible à établir, date non résoluble,
          // etc.) : la page est relue depuis son début à la reprise — aucune commande n'est
          // sautée ni importée de travers, et les compteurs déjà acquis sont conservés.
          const isBlocking =
            message.startsWith('LIGHTFUNNELS_ORDER_LINE_AMBIGUOUS') ||
            message.startsWith('LIGHTFUNNELS_ORDER_DATE_UNRESOLVABLE')

          failureReason = isBlocking ? message : `ORDER_UPSERT_BLOCKED:${message}`
          cursor = pageStartCursor
          hasMore = true
          if (!warnings.includes(failureReason)) warnings.push(failureReason)
          await persistImportProgress(failureReason)
          pageAborted = true
          return null
        }
      })()

      if (!result) break

      if (result.status === 'created') {
        imported += 1

        // La liaison orpheline n'est « réparée » qu'ici : une commande ignorée ou refusée
        // ensuite reste un échec visible, jamais une réparation annoncée à tort.
        if (recoversOrphan) repairedOrphans += 1

        for (const warning of result.warnings || []) {
          if (!warnings.includes(warning)) warnings.push(warning)
        }

        continue
      }

      if (result.status === 'already_imported') {
        alreadyImported += 1
        continue
      }

      skipped += 1
      const reason = result.reason || 'UNKNOWN'
      skippedReasons[reason] = (skippedReasons[reason] || 0) + 1

      if (reason === 'BEFORE_SINCE_DATE') {
        reachedSinceDate = true
        break
      }
    }

    if (pageAborted) break

    cursor = page.endCursor
    hasMore = page.hasNextPage

    if (reachedSinceDate || !page.hasNextPage) {
      hasMore = false
      cursor = null
      if (!(await persistImportProgress())) progressFailed = true
      break
    }

    // Progression enregistrée page par page : sans curseur enregistré, la reprise annoncée
    // n'existe pas — l'import s'arrête et le signale au lieu de poursuivre.
    if (!(await persistImportProgress())) {
      progressFailed = true
      hasMore = true
      break
    }
  }

  // Liaisons incohérentes : elles empêchent de conclure l'import (le bilan n'est pas « ok »).
  if (needsRepair > 0) {
    warnings.push(`ORDER_MAPPED_TO_OTHER_STORE:${needsRepair}`)
  }

  // Liaisons orphelines réparées : des ventes supprimées ont été recréées, l'utilisateur doit
  // le savoir (le nombre suffit, aucun identifiant distant n'est exposé sans utilité).
  if (repairedOrphans > 0) {
    warnings.push(`ORDER_MAPPING_ORPHANS_REPAIRED:${repairedOrphans}`)
  }

  // Fin de parcours sans aucune nouveauté : l'historique est réellement à jour (le parcours
  // va jusqu'à la date plancher ou la fin des pages, jamais arrêté sur une page déjà connue —
  // sinon une commande ancienne manquante resterait introuvable). Une liaison incohérente
  // (`needsRepair`) interdit de conclure : le bilan reste « à réparer ».
  if (
    !hasMore &&
    !progressFailed &&
    !failureReason &&
    needsRepair === 0 &&
    imported === 0 &&
    alreadyImported > 0
  ) {
    if (!warnings.includes('HISTORY_UP_TO_DATE')) warnings.push('HISTORY_UP_TO_DATE')
  }

  const summary: LightfunnelsImportSummary = {
    // Une liaison incohérente rend le bilan non concluant : `ok` reste faux pour que l'appelant
    // ne présente ni « historique à jour » ni succès.
    ok: !progressFailed && !failureReason && needsRepair === 0,
    ...(failureReason
      ? { reason: failureReason }
      : progressFailed
        ? { reason: 'IMPORT_PROGRESS_NOT_SAVED' }
        : needsRepair > 0
          ? { reason: 'ORDER_MAPPING_NEEDS_REPAIR' }
          : {}),
    scanned,
    imported,
    alreadyImported,
    needsRepair,
    skipped,
    skippedReasons,
    warnings,
    hasMore,
    cursor,
  }

  // Un échec conserve son motif sur la liaison (visible dans l'assistant) ; un succès l'efface.
  if (!progressFailed && !(await persistImportProgress(failureReason))) {
    summary.ok = false
    summary.reason = 'IMPORT_PROGRESS_NOT_SAVED'
  }

  return summary
}



