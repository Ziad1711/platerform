import crypto from 'crypto'

/**
 * Client API Lightfunnels.
 *
 * Sources vérifiées :
 * - authentification OAuth2 v3 (token en 2 h, refresh rotatif à usage unique) :
 *   https://developer.lightfunnels.com/authentication
 * - API GraphQL unique (POST) : https://services.lightfunnels.com/api/v2
 * - webhooks signés par l'en-tête `lightfunnels-hmac` (HMAC-SHA256 base64 du corps JSON) :
 *   https://developer.lightfunnels.com/webhooks
 * - pagination par curseur : https://developer.lightfunnels.com/pagination
 * - commande (total / subtotal / shipping / currency / items) :
 *   https://developer.lightfunnels.com/orders/types
 *
 * Aucune écriture n'est faite vers Lightfunnels en dehors de la gestion des webhooks.
 */

export const LIGHTFUNNELS_PROVIDER = 'lightfunnels'

const LIGHTFUNNELS_DEFAULT_API_BASE_URL = 'https://services.lightfunnels.com/api/v2'
const LIGHTFUNNELS_DEFAULT_TOKEN_URL = 'https://api.lightfunnels.com/api/v3/access_token'
const LIGHTFUNNELS_DEFAULT_CONSENT_URL = 'https://app.lightfunnels.com/admin/oauth'

/**
 * URLs des services Lightfunnels.
 *
 * Les valeurs de production sont les valeurs par défaut. Elles sont surchargeables par
 * variables d'environnement afin de pouvoir dérouler le parcours complet (consentement,
 * jetons, GraphQL, webhooks) contre un service simulé, sans toucher au code.
 */
export function getLightfunnelsEndpoints() {
  return {
    apiBaseUrl:
      (process.env.LIGHTFUNNELS_API_BASE_URL || '').trim() || LIGHTFUNNELS_DEFAULT_API_BASE_URL,
    tokenUrl:
      (process.env.LIGHTFUNNELS_TOKEN_URL || '').trim() || LIGHTFUNNELS_DEFAULT_TOKEN_URL,
    consentUrl:
      (process.env.LIGHTFUNNELS_CONSENT_URL || '').trim() || LIGHTFUNNELS_DEFAULT_CONSENT_URL,
  }
}
/**
 * Scopes demandés :
 * - `orders` : lire les commandes ;
 * - `products` : lire le catalogue — **sans** ce scope, toute requête `products` est refusée
 *   par Lightfunnels (l'import du catalogue échoue alors sans lire un seul produit) ;
 * - `funnels` : lire les boutiques du compte (la documentation rattache `account.stores` au
 *   scope `funnels`).
 * Référence : https://developer.lightfunnels.com/scopes
 */
export const LIGHTFUNNELS_SCOPES = 'orders,products,funnels'

export const LIGHTFUNNELS_WEBHOOK_EVENT_ORDER_CONFIRMED = 'order/confirmed'

export type LightfunnelsConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export function getLightfunnelsConfig(): LightfunnelsConfig | null {
  const clientId = (process.env.LIGHTFUNNELS_CLIENT_ID || '').trim()
  const clientSecret = (process.env.LIGHTFUNNELS_CLIENT_SECRET || '').trim()
  const redirectUri = (process.env.LIGHTFUNNELS_REDIRECT_URI || '').trim()

  if (!clientId || !clientSecret || !redirectUri) return null

  return { clientId, clientSecret, redirectUri }
}

export function buildLightfunnelsAuthorizeUrl(params: {
  clientId: string
  redirectUri: string
  state: string
  scopes?: string
}) {
  const url = new URL(getLightfunnelsEndpoints().consentUrl)
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('scope', params.scopes || LIGHTFUNNELS_SCOPES)
  url.searchParams.set('state', params.state)
  return url.toString()
}

export type LightfunnelsTokenResponse = {
  access_token: string
  refresh_token?: string | null
  expires_in?: number | null
  token_type?: string | null
}

async function requestLightfunnelsTokens(body: URLSearchParams) {
  const response = await fetch(getLightfunnelsEndpoints().tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`LIGHTFUNNELS_TOKEN_FAILED:${text}`)
  }

  const payload = (await response.json()) as LightfunnelsTokenResponse
  if (!payload?.access_token) {
    throw new Error('LIGHTFUNNELS_TOKEN_FAILED:MISSING_ACCESS_TOKEN')
  }

  return payload
}

/** Échange le code d'autorisation (valable 10 minutes, usage unique). */
export async function exchangeLightfunnelsCode(params: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
}) {
  return requestLightfunnelsTokens(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    })
  )
}

/** Rafraîchit l'accès : chaque appel renvoie un nouveau refresh token, l'ancien est invalidé. */
export async function refreshLightfunnelsToken(params: {
  refreshToken: string
  clientId: string
  clientSecret: string
}) {
  return requestLightfunnelsTokens(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    })
  )
}

export type LightfunnelsGraphqlResult<T> = {
  data: T | null
  errors: string[]
}

/**
 * Réponse « rate limit » du fournisseur. Elle ne signifie **pas** que la requête est
 * invalide : réessayer une autre variante ne fait qu'aggraver la limitation, et retenter
 * immédiatement en boucle est inutile. Les appelants l'utilisent pour arrêter proprement.
 */
export function isLightfunnelsRateLimitError(message: string) {
  const value = String(message || '')
  return /rate limit/i.test(value) || value.includes('LIGHTFUNNELS_HTTP_429')
}

const RATE_LIMIT_RETRY_DELAY_MS = 1500
/**
 * Budget d'attente qu'une requête peut s'offrir avant de retenter un appel limité. Une consigne
 * plus longue n'est **jamais raccourcie** : on ne retente pas (retenter avant l'échéance
 * reviendrait à ignorer la consigne) et l'appelant reprend l'import au curseur enregistré.
 */
const MAX_RATE_LIMIT_WAIT_MS = 8000

async function waitForRetry(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Attente demandée par le fournisseur (`Retry-After`) : `requestedMs` est la consigne **telle
 * quelle** (jamais raccourcie à l'insu de l'appelant), `waitMs` sa version utilisable
 * immédiatement.
 */
function rateLimitWait(retryAfterHeader: string | null) {
  const seconds = Number(String(retryAfterHeader || '').trim())

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { waitMs: RATE_LIMIT_RETRY_DELAY_MS, requestedMs: null as number | null }
  }

  return {
    waitMs: Math.min(seconds * 1000, MAX_RATE_LIMIT_WAIT_MS),
    requestedMs: Math.round(seconds * 1000),
  }
}

type LightfunnelsAttempt<T> = {
  data: T | null
  errors: string[]
  /** Limitation de débit : HTTP 429 ou erreur GraphQL « rate limit ». */
  rateLimited: boolean
  /** Erreur HTTP hors limitation : message prêt à être lancé. */
  httpError: string | null
  /** Attente avant nouvelle tentative (consigne du fournisseur, bornée au budget disponible). */
  waitMs: number
  /** Consigne `Retry-After` telle quelle, sans plafond (null si le fournisseur n'en donne pas). */
  retryAfterMs: number | null
}

/**
 * Requête GraphQL brute. Les erreurs applicatives arrivent avec un HTTP 200 :
 * le tableau `errors` est donc toujours remonté, sans être masqué par des données partielles.
 */
export async function lightfunnelsRawRequest<T = any>(params: {
  accessToken: string
  query: string
  variables?: Record<string, unknown>
}): Promise<LightfunnelsGraphqlResult<T>> {
  const run = async (): Promise<LightfunnelsAttempt<T>> => {
    const response = await fetch(getLightfunnelsEndpoints().apiBaseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query: params.query,
        variables: params.variables || {},
      }),
    })

    const raw = await response.text()

    if (!response.ok) {
      const rateLimit = rateLimitWait(response.headers.get('retry-after'))

      // Seul le 429 est une limitation : les autres codes sont des erreurs définitives et
      // gardent leur message d'origine (401/403 sont reconnus par les appelants).
      return {
        data: null,
        errors: [],
        rateLimited: response.status === 429,
        httpError:
          response.status === 429
            ? null
            : `LIGHTFUNNELS_HTTP_${response.status}:${raw.slice(0, 600)}`,
        waitMs: rateLimit.waitMs,
        retryAfterMs: response.status === 429 ? rateLimit.requestedMs : null,
      }
    }

    let payload: any = null
    try {
      payload = raw ? JSON.parse(raw) : null
    } catch {
      throw new Error('LIGHTFUNNELS_INVALID_JSON')
    }

    const errors: string[] = Array.isArray(payload?.errors)
      ? payload.errors.map((error: any) => String(error?.message || error?.key || 'UNKNOWN'))
      : []

    return {
      data: (payload?.data ?? null) as T | null,
      errors,
      rateLimited: errors.some(isLightfunnelsRateLimitError),
      httpError: null,
      waitMs: RATE_LIMIT_RETRY_DELAY_MS,
      retryAfterMs: null,
    }
  }

  const first = await run()

  // Une seule nouvelle tentative, après l'attente demandée par le fournisseur : au-delà,
  // la limitation est durable et l'appelant doit arrêter son traitement au lieu d'insister.
  // Une consigne `Retry-After` plus longue que le budget d'attente n'est **jamais raccourcie** :
  // retenter plus tôt reviendrait à l'ignorer — l'import s'arrête et reprendra au curseur.
  if (first.rateLimited) {
    if (first.retryAfterMs !== null && first.retryAfterMs > MAX_RATE_LIMIT_WAIT_MS) {
      throw new Error(
        `LIGHTFUNNELS_RATE_LIMITED:retry_after=${Math.ceil(first.retryAfterMs / 1000)}s`
      )
    }

    await waitForRetry(first.waitMs)
    const second = await run()

    if (second.rateLimited) {
      throw new Error(
        `LIGHTFUNNELS_RATE_LIMITED:${(second.errors.join(' | ') || 'HTTP_429').slice(0, 300)}`
      )
    }

    if (second.httpError) throw new Error(second.httpError)

    return { data: second.data, errors: second.errors }
  }

  if (first.httpError) throw new Error(first.httpError)

  return { data: first.data, errors: first.errors }
}

/** Requête GraphQL : renvoie les données ou lève une erreur explicite. */
export async function lightfunnelsGraphql<T = any>(params: {
  accessToken: string
  query: string
  variables?: Record<string, unknown>
}): Promise<T> {
  const { data, errors } = await lightfunnelsRawRequest<T>(params)

  if (errors.length > 0) {
    throw new Error(`LIGHTFUNNELS_GRAPHQL_ERROR:${errors.join(' | ')}`)
  }

  return (data || {}) as T
}

export const LIGHTFUNNELS_STORES_QUERY = `query JisraStoresQuery {
  account {
    stores {
      id
      uid
      name
      slug
    }
  }
}`

export type LightfunnelsStoreRecord = {
  id: string
  uid?: string | null
  name?: string | null
  slug?: string | null
}

/** Boutiques du compte : la liaison Lightfunnels <-> Jisra est choisie explicitement. */
export async function listLightfunnelsStores(params: { accessToken: string }) {
  const data = await lightfunnelsGraphql<{ account?: { stores?: LightfunnelsStoreRecord[] } }>({
    accessToken: params.accessToken,
    query: LIGHTFUNNELS_STORES_QUERY,
  })

  const stores = data?.account?.stores
  return Array.isArray(stores) ? stores.filter((store) => Boolean(store?.id)) : []
}

/**
 * Nombre de boutiques réellement présentes dans le **compte distant**.
 *
 * Sert à prouver qu'une commande ou un produit sans `store_id` est sans ambiguïté : le nombre
 * de liaisons Jisra ne le prouve pas (un compte peut avoir plusieurs boutiques dont une seule
 * est liée, et plusieurs liaisons peuvent viser la même boutique).
 *
 * Renvoie `null` quand la réponse ne permet pas de conclure (appel en échec, schéma sans
 * `account.stores`) : l'appelant doit alors refuser l'import non prouvé, jamais le deviner.
 */
export async function countLightfunnelsAccountStores(params: { accessToken: string }) {
  try {
    const stores = await listLightfunnelsStores({ accessToken: params.accessToken })
    return stores.length > 0 ? stores.length : null
  } catch (error) {
    const message = error instanceof Error ? error.message : 'STORES_LOOKUP_FAILED'
    console.error('[lightfunnels][stores] lookup failed', { message })
    return null
  }
}

export const LIGHTFUNNELS_ORDER_HEADLINE_FIELDS = `id
        _id
        name
        total
        subtotal
        shipping
        discount_value
        currency
        account_id
        financial_status
        fulfillment_status
        cancelled_at
        archived_at
        created_at
        updated_at
        phone
        email
        notes
        test
        customer {
          id
          full_name
        }`

/** `store_id` figure dans les payloads de webhook ; il n'est donc pas garanti interrogeable. */
export const LIGHTFUNNELS_STORE_ID_FIELD = `
        store_id`

function buildOrdersQuery(includeStoreId: boolean) {
  return `query JisraOrdersQuery($first: Int, $after: String, $query: String!) {
  orders(first: $first, after: $after, query: $query) {
    edges {
      node {
        ${LIGHTFUNNELS_ORDER_HEADLINE_FIELDS}${includeStoreId ? LIGHTFUNNELS_STORE_ID_FIELD : ''}
      }
      cursor
    }
    pageInfo {
      endCursor
      hasNextPage
    }
  }
}`
}

export type LightfunnelsOrderConnection = {
  orders?: {
    edges?: Array<{ node?: any; cursor?: string | null }> | null
    pageInfo?: { endCursor?: string | null; hasNextPage?: boolean | null } | null
  } | null
}

/**
 * Variante de requête retenue pour ce processus : éviter de réessayer indéfiniment une
 * sélection de champs refusée par le schéma installé.
 */
let ordersQuerySupportsStoreId: boolean | null = null

/**
 * Liste paginée des commandes (curseur). Le tri est imposé par Lightfunnels :
 * `order_by:id order_dir:desc` renvoie les commandes les plus récentes en premier.
 */
export async function listLightfunnelsOrders(params: {
  accessToken: string
  first?: number
  after?: string | null
}) {
  const first = params.first || 25

  const run = async (includeStoreId: boolean) => {
    const result = await lightfunnelsRawRequest<LightfunnelsOrderConnection>({
      accessToken: params.accessToken,
      query: buildOrdersQuery(includeStoreId),
      variables: {
        first,
        after: params.after || null,
        query: 'order_by:id order_dir:desc',
      },
    })

    const edges = result.data?.orders?.edges || []
    const pageInfo = result.data?.orders?.pageInfo || {}

    return {
      errors: result.errors,
      orders: edges.map((edge) => edge?.node).filter((node) => Boolean(node?.id)),
      endCursor: pageInfo.endCursor ?? null,
      hasNextPage: Boolean(pageInfo.hasNextPage),
    }
  }

  if (ordersQuerySupportsStoreId !== false) {
    const attempt = await run(true)
    if (attempt.errors.length === 0) {
      ordersQuerySupportsStoreId = true
      return { ...attempt, storeIdAvailable: true, warnings: [] as string[] }
    }

    ordersQuerySupportsStoreId = false
  }

  const fallback = await run(false)
  if (fallback.errors.length > 0) {
    throw new Error(`LIGHTFUNNELS_GRAPHQL_ERROR:${fallback.errors.join(' | ')}`)
  }

  return {
    ...fallback,
    storeIdAvailable: false,
    warnings: ['ORDERS_QUERY_WITHOUT_STORE_ID'],
  }
}

/**
 * Champs produits documentés : `price`, `compare_at_price`, `sku`, `slug`, `description`,
 * `thumbnail`, `options`, `variants` (id, title, sku, price, compare_at_price, options).
 * Référence : https://developer.lightfunnels.com/products/types
 */
/**
 * Boutiques du produit. Le schéma documenté expose la relation `stores` (`[Store!]!`) et
 * **pas** de champ `store_id` sur `Product` : demander `store_id` fait échouer la requête
 * entière, donc l'import n'aurait plus aucune vérification de boutique.
 * Référence : https://developer.lightfunnels.com/products/types
 */
export const LIGHTFUNNELS_PRODUCT_STORES_FIELD = `
        stores {
          id
        }`

function buildProductsQuery(options: { details: boolean; thumbnail: boolean; stores: boolean }) {
  const thumbnail = options.thumbnail
    ? `
        thumbnail {
          path(version: version1)
        }`
    : ''

  const variants = options.details
    ? `
        variants {
          id
          title
          sku
          price
          compare_at_price
          options {
            id
            value
          }
        }`
    : `
        variants {
          id
          price
          sku
        }`

  return `query JisraProductsQuery($first: Int, $after: String, $query: String!) {
  products(first: $first, after: $after, query: $query) {
    edges {
      node {
        id
        _id
        title
        slug
        description
        price
        compare_at_price
        sku
        created_at
        updated_at${thumbnail}${variants}${options.stores ? LIGHTFUNNELS_PRODUCT_STORES_FIELD : ''}
      }
      cursor
    }
    pageInfo {
      endCursor
      hasNextPage
    }
  }
}`
}

/**
 * Combinaisons essayées pour les produits, du plus complet au plus minimal. La première
 * acceptée est mémorisée. `storeIdAvailable` indique si la boutique du produit a pu être
 * lue (relation `stores`), donc si l'appartenance peut être vérifiée.
 */
const PRODUCT_QUERY_VARIANTS = [
  { details: true, thumbnail: true, stores: true },
  { details: true, thumbnail: true, stores: false },
  { details: true, thumbnail: false, stores: false },
  { details: false, thumbnail: false, stores: false },
  { details: false, thumbnail: false, stores: true },
]

let productQueryVariantIndex: number | null = null

/**
 * Liste paginée du catalogue (curseur). Filtres documentés : `order_by`, `order_dir`.
 * `storeIdAvailable` est faux quand la boutique du produit n'est pas exposée : l'appelant
 * refuse alors d'importer un compte multi-boutiques dans un store unique.
 *
 * Chaque échec est conservé : sans le motif exact, une permission manquante (scope
 * `products`) et un champ inconnu seraient indistinguables derrière le seul code
 * `LIGHTFUNNELS_PRODUCTS_FETCH_FAILED`.
 */
export async function listLightfunnelsProducts(params: {
  accessToken: string
  first?: number
  after?: string | null
}) {
  const warnings: string[] = []
  const attempts: string[] = []
  const startIndex = productQueryVariantIndex ?? 0

  for (let index = startIndex; index < PRODUCT_QUERY_VARIANTS.length; index += 1) {
    const variant = PRODUCT_QUERY_VARIANTS[index]

    const result = await lightfunnelsRawRequest<any>({
      accessToken: params.accessToken,
      query: buildProductsQuery(variant),
      variables: {
        first: params.first || 25,
        after: params.after || null,
        query: 'order_by:id order_dir:desc',
      },
    })

    if (result.errors.length === 0) {
      const edges = result.data?.products?.edges || []
      const pageInfo = result.data?.products?.pageInfo || {}
      productQueryVariantIndex = index

      if (!variant.stores && !warnings.includes('PRODUCTS_WITHOUT_STORE_ID')) {
        warnings.push('PRODUCTS_WITHOUT_STORE_ID')
      }

      return {
        products: edges.map((edge: any) => edge?.node).filter((node: any) => Boolean(node?.id)),
        endCursor: pageInfo.endCursor ?? null,
        hasNextPage: Boolean(pageInfo.hasNextPage),
        storeIdAvailable: variant.stores,
        warnings,
      }
    }

    const detail = result.errors.join(' | ').slice(0, 220)
    attempts.push(`essai${index + 1}=${detail}`)
    warnings.push(`PRODUCTS_QUERY_FALLBACK:${detail}`)
  }

  throw new Error(`LIGHTFUNNELS_PRODUCTS_FETCH_FAILED:${attempts.join(' || ').slice(0, 900)}`)
}

/**
 * Détail d'une commande.
 *
 * Les champs facultatifs sont demandés par paliers (adresses portées par la commande, puis par
 * le client, puis `store_id`, puis lignes réduites) et **le motif exact de chaque échec est
 * conservé** : sans lui, un champ inconnu et une limitation de débit seraient indistinguables
 * derrière le seul code `LIGHTFUNNELS_ORDER_FETCH_FAILED`.
 */
const LIGHTFUNNELS_ORDER_ITEMS_FIELDS = `items {
          __typename
          ... on VariantSnapshot {
            id
            title
            sku
            price
            product_id
            variant_id
            removed_at
            options {
              id
              label
              value
            }
          }
          ... on OrderBumpSnapshot {
            id
            title
            sku
            price
            removed_at
          }
        }`

/** Lignes réduites : identité, libellé, prix — suffisant pour recréer une vente. */
const LIGHTFUNNELS_ORDER_ITEMS_MINIMAL_FIELDS = `items {
          __typename
          ... on VariantSnapshot {
            id
            title
            sku
            price
            removed_at
          }
          ... on OrderBumpSnapshot {
            id
            title
            sku
            price
            removed_at
          }
        }`

const LIGHTFUNNELS_ORDER_ADDRESS_FIELDS = `
        shipping_address {
          first_name
          last_name
          email
          phone
          line1
          line2
          city
          state
          zip
          country
        }
        billing_address {
          first_name
          last_name
          email
          phone
          line1
          line2
          city
          state
          zip
          country
        }`

/** Adresses portées par le client quand la commande ne les expose pas. */
const LIGHTFUNNELS_CUSTOMER_ADDRESS_FIELDS = `
        customer {
          id
          full_name
          shipping_address {
            first_name
            last_name
            full_name
            email
            phone
            line1
            line2
            city
            area
            state
            zip
            country
          }
          billing_address {
            first_name
            last_name
            full_name
            email
            phone
            line1
            line2
            city
            area
            state
            zip
            country
          }
        }`

/** En-tête sans le bloc `customer`, pour ne jamais le sélectionner deux fois. */
const LIGHTFUNNELS_ORDER_HEADLINE_WITHOUT_CUSTOMER = `id
        _id
        name
        total
        subtotal
        shipping
        discount_value
        currency
        account_id
        financial_status
        fulfillment_status
        cancelled_at
        archived_at
        created_at
        updated_at
        phone
        email
        notes
        test`

/** En-tête minimal : de quoi identifier et dater la commande. */
const LIGHTFUNNELS_ORDER_HEADLINE_MINIMAL = `id
        _id
        name
        total
        created_at
        cancelled_at
        financial_status
        fulfillment_status
        test`

type OrderDetailAttempt = {
  headline: 'full' | 'minimal'
  items: 'full' | 'minimal' | 'none'
  addresses: 'order' | 'customer' | 'none'
  storeId: boolean
  /**
   * Palier de **diagnostic** : il confirme que la commande existe et que l'en-tête est lisible,
   * mais une réponse sans articles n'est jamais importable — elle servirait à créer une vente
   * vide. Le résultat sert donc à expliquer l'échec, jamais à importer.
   */
  diagnosticOnly?: boolean
}

/**
 * Paliers essayés dans l'ordre, du plus riche au plus minimal. Le premier accepté est
 * mémorisé pour le reste du processus.
 */
const ORDER_DETAIL_VARIANTS: OrderDetailAttempt[] = [
  { headline: 'full', items: 'full', addresses: 'order', storeId: true },
  { headline: 'full', items: 'full', addresses: 'order', storeId: false },
  { headline: 'full', items: 'full', addresses: 'customer', storeId: false },
  { headline: 'full', items: 'full', addresses: 'none', storeId: false },
  { headline: 'full', items: 'minimal', addresses: 'none', storeId: false },
  { headline: 'minimal', items: 'minimal', addresses: 'none', storeId: false },
  { headline: 'minimal', items: 'none', addresses: 'none', storeId: false, diagnosticOnly: true },
]

let orderDetailVariantIndex: number | null = null

function buildOrderDetailQuery(attempt: OrderDetailAttempt) {
  const headline =
    attempt.headline === 'minimal'
      ? LIGHTFUNNELS_ORDER_HEADLINE_MINIMAL
      : attempt.addresses === 'customer'
        ? LIGHTFUNNELS_ORDER_HEADLINE_WITHOUT_CUSTOMER
        : LIGHTFUNNELS_ORDER_HEADLINE_FIELDS

  const items =
    attempt.items === 'full'
      ? LIGHTFUNNELS_ORDER_ITEMS_FIELDS
      : attempt.items === 'minimal'
        ? LIGHTFUNNELS_ORDER_ITEMS_MINIMAL_FIELDS
        : ''

  const addresses =
    attempt.addresses === 'order'
      ? LIGHTFUNNELS_ORDER_ADDRESS_FIELDS
      : attempt.addresses === 'customer'
        ? LIGHTFUNNELS_CUSTOMER_ADDRESS_FIELDS
        : ''

  return `query JisraOrderQuery($id: ID!) {
  node(id: $id) {
    ... on Order {
      ${headline}${attempt.storeId ? LIGHTFUNNELS_STORE_ID_FIELD : ''}${items ? `\n      ${items}` : ''}${addresses}
    }
  }
}`
}

export async function getLightfunnelsOrder(params: {
  accessToken: string
  orderId: string
}) {
  const warnings: string[] = []
  const attempts: string[] = []
  const startIndex = orderDetailVariantIndex ?? 0

  for (let index = startIndex; index < ORDER_DETAIL_VARIANTS.length; index += 1) {
    const variant = ORDER_DETAIL_VARIANTS[index]

    const result = await lightfunnelsRawRequest<{ node?: any }>({
      accessToken: params.accessToken,
      query: buildOrderDetailQuery(variant),
      variables: { id: params.orderId },
    })

    if (result.errors.length === 0 && result.data?.node) {
      if (variant.diagnosticOnly) {
        // L'en-tête est lisible mais les articles sont refusés : la commande n'est pas
        // importable — le palier explique l'échec et la boucle se termine sur un refus explicite.
        attempts.push(`essai${index + 1}=items_refuses`)
        continue
      }

      orderDetailVariantIndex = index
      const node = result.data.node as any
      const customer = node?.customer || {}

      // Les adresses du client sont remontées au niveau de la commande : la lecture reste
      // unique, où que le schéma les expose.
      const order =
        variant.addresses === 'customer' && !node?.shipping_address
          ? {
              ...node,
              shipping_address: customer?.shipping_address ?? null,
              billing_address: customer?.billing_address ?? null,
            }
          : node

      return {
        order,
        addressesAvailable: variant.addresses !== 'none',
        storeIdAvailable: variant.storeId,
        warnings,
      }
    }

    const detail = result.errors.join(' | ').slice(0, 200)
    attempts.push(`essai${index + 1}=${detail || 'NO_DATA'}`)

    // Limitation de débit : inutile d'essayer d'autres variantes, l'appelant doit s'arrêter.
    if (detail && isLightfunnelsRateLimitError(detail)) {
      throw new Error(`LIGHTFUNNELS_RATE_LIMITED:${detail}`)
    }
  }

  if (attempts.some((entry) => entry.endsWith('=items_refuses'))) {
    throw new Error(
      `LIGHTFUNNELS_ORDER_DETAIL_INCOMPLETE:${params.orderId}:${attempts.join(' || ').slice(0, 700)}`
    )
  }

  if (attempts.length > 0 && attempts.every((entry) => entry.endsWith('=NO_DATA'))) {
    throw new Error(`LIGHTFUNNELS_ORDER_NOT_FOUND:${params.orderId}`)
  }

  throw new Error(
    `LIGHTFUNNELS_ORDER_FETCH_FAILED:${params.orderId}:${attempts.join(' || ').slice(0, 700)}`
  )
}

export const LIGHTFUNNELS_WEBHOOKS_QUERY = `query JisraWebhooksQuery {
  webhooks {
    id
    _id
    version
    url
    type
  }
}`

export type LightfunnelsWebhookRecord = {
  id?: string | null
  _id?: string | number | null
  type?: string | null
  url?: string | null
}

export async function listLightfunnelsWebhooks(params: { accessToken: string }) {
  const data = await lightfunnelsGraphql<{ webhooks?: LightfunnelsWebhookRecord[] }>({
    accessToken: params.accessToken,
    query: LIGHTFUNNELS_WEBHOOKS_QUERY,
  })

  const hooks = data?.webhooks
  return Array.isArray(hooks) ? hooks.filter((hook) => Boolean(hook?.id)) : []
}

/**
 * Enregistre un webhook. `version` est optionnel : il est omis au premier essai (exemple
 * officiel) et n'est envoyé que si l'API l'exige explicitement.
 */
export async function createLightfunnelsWebhook(params: {
  accessToken: string
  type: string
  url: string
}) {
  const mutation = `mutation JisraWebhookCreate($node: WebhookInput!) {
  createWebhook(node: $node) {
    id
    _id
    type
    url
  }
}`

  const withoutVersion = await lightfunnelsRawRequest<{ createWebhook?: LightfunnelsWebhookRecord }>({
    accessToken: params.accessToken,
    query: mutation,
    variables: { node: { type: params.type, url: params.url, settings: {} } },
  })

  if (withoutVersion.errors.length === 0 && withoutVersion.data?.createWebhook?.id) {
    return withoutVersion.data.createWebhook
  }

  const requiresVersion = withoutVersion.errors.some((error) => error.toLowerCase().includes('version'))

  if (!requiresVersion) {
    throw new Error(`LIGHTFUNNELS_WEBHOOK_CREATE_FAILED:${withoutVersion.errors.join(' | ') || 'UNKNOWN'}`)
  }

  const withVersion = await lightfunnelsRawRequest<{ createWebhook?: LightfunnelsWebhookRecord }>({
    accessToken: params.accessToken,
    query: mutation,
    variables: { node: { type: params.type, url: params.url, version: 'v2', settings: {} } },
  })

  if (withVersion.errors.length > 0 || !withVersion.data?.createWebhook?.id) {
    throw new Error(`LIGHTFUNNELS_WEBHOOK_CREATE_FAILED:${withVersion.errors.join(' | ') || 'UNKNOWN'}`)
  }

  return withVersion.data.createWebhook
}

export async function deleteLightfunnelsWebhook(params: { accessToken: string; webhookId: string }) {
  const data = await lightfunnelsGraphql<{ deleteWebhook?: string | null }>({
    accessToken: params.accessToken,
    query: `mutation JisraWebhookDelete($id: ID!) {
  deleteWebhook(id: $id)
}`,
    variables: { id: params.webhookId },
  })

  return data?.deleteWebhook ?? null
}

/**
 * Vérifie l'en-tête `lightfunnels-hmac` : HMAC-SHA256 en base64 du corps JSON, calculé
 * avec le client secret. Le corps brut est utilisé en priorité, puis le JSON recanonisé
 * (l'exemple officiel signe `JSON.stringify(req.body)`).
 */
export function verifyLightfunnelsWebhookSignature(params: {
  signature: string
  rawBody: string
  clientSecret: string
}) {
  const received = String(params.signature || '').trim()
  if (!received || !params.clientSecret) return false

  const candidates = [params.rawBody]

  try {
    candidates.push(JSON.stringify(JSON.parse(params.rawBody || '{}')))
  } catch {
    // Corps non JSON : seul le corps brut est comparable.
  }

  const receivedBuffer = Buffer.from(received, 'base64')

  for (const body of candidates) {
    const expected = crypto
      .createHmac('sha256', params.clientSecret)
      .update(body, 'utf8')
      .digest('base64')

    const expectedBuffer = Buffer.from(expected, 'base64')

    if (
      receivedBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      return true
    }
  }

  return false
}

export type LightfunnelsOAuthStatePayload = {
  userId: string
  /** Store Jisra de départ : sert à proposer la liaison, jamais à l'imposer. */
  storeId: string
  ts: number
  nonce: string
}

/**
 * `state` OAuth signé (HMAC-SHA256, 15 minutes). Aucun jeton de session Jisra n'y est
 * placé, contrairement à l'implémentation YouCan : le callback s'appuie sur la session
 * (cookie) de l'utilisateur.
 */
export function createLightfunnelsOAuthState(payload: LightfunnelsOAuthStatePayload, secret: string) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url')
  return `${encodedPayload}.${signature}`
}

export function parseLightfunnelsOAuthState(
  rawState: string,
  secret: string,
  maxAgeSeconds = 15 * 60
): LightfunnelsOAuthStatePayload | null {
  const [encodedPayload, receivedSignature] = String(rawState || '').split('.')
  if (!encodedPayload || !receivedSignature) return null

  const expectedSignature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url')
  const receivedBuffer = Buffer.from(receivedSignature)
  const expectedBuffer = Buffer.from(expectedSignature)

  if (receivedBuffer.length !== expectedBuffer.length) return null
  if (!crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) return null

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as LightfunnelsOAuthStatePayload

    if (!payload?.userId || typeof payload.ts !== 'number') return null
    if (Date.now() - payload.ts > maxAgeSeconds * 1000) return null

    return payload
  } catch {
    return null
  }
}

/**
 * Lightfunnels renvoie `created_at` sous la forme `YYYY-MM-DD HH:mm:ss`, sans fuseau
 * (exemple officiel : `2024-03-18 14:20:37`). Ces valeurs sont interprétées en UTC.
 */
export function parseLightfunnelsDate(value: unknown): Date | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    const date = new Date(`${raw.replace(' ', 'T')}Z`)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

export function isLightfunnelsTestOrder(order: any): boolean {
  return order?.test === true
}

function readNonBlankString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string' && typeof value !== 'number') continue
    const normalized = String(value).trim()
    if (normalized.length > 0) return normalized
  }

  return null
}

/** Adresse de livraison prioritaire, repli sur la facturation. */
export function readLightfunnelsAddress(order: any) {
  const shipping = order?.shipping_address || {}
  const billing = order?.billing_address || {}

  const addressLine = readNonBlankString(
    [shipping?.line1, shipping?.line2].filter(Boolean).join(', '),
    shipping?.line1,
    [billing?.line1, billing?.line2].filter(Boolean).join(', '),
    billing?.line1
  )

  const city = readNonBlankString(shipping?.city, shipping?.area, billing?.city, billing?.area)

  const phone = readNonBlankString(
    shipping?.phone,
    billing?.phone,
    order?.phone
  )

  const name =
    readNonBlankString(
      [shipping?.first_name, shipping?.last_name].filter(Boolean).join(' '),
      shipping?.full_name,
      order?.customer_full_name,
      order?.customer?.full_name,
      [billing?.first_name, billing?.last_name].filter(Boolean).join(' '),
      billing?.full_name,
      order?.email
    ) || 'Client Lightfunnels'

  return { name, phone, address: addressLine, city }
}

export type LightfunnelsOrderLine = {
  /** Identifiant du snapshot : un snapshot Lightfunnels représente une unité. */
  itemId: string
  itemTypeName: string
  title: string
  sku: string
  productId: string
  variantId: string
  unitPrice: number
  optionsLabel: string | null
}

/**
 * Lignes de commande normalisées. `quantity` n'existe pas sur `VariantSnapshot` /
 * `OrderBumpSnapshot` : chaque entrée vaut une unité, la quantité est donc déduite du
 * nombre de snapshots identiques (regroupement fait par l'import).
 */
export function readLightfunnelsOrderLines(order: any): LightfunnelsOrderLine[] {
  const items = Array.isArray(order?.items) ? order.items : []
  const lines: LightfunnelsOrderLine[] = []

  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    // Les lignes retirées ou remboursées ne font pas partie de la commande encaissée.
    if (item.removed_at) continue

    const optionsLabel = Array.isArray(item.options)
      ? item.options
          .map((option: any) => readNonBlankString(option?.value))
          .filter((value: string | null): value is string => Boolean(value))
          .join(' / ') || null
      : null

    lines.push({
      itemId: String(item.id || item._id || '').trim(),
      itemTypeName: String(item.__typename || '').trim(),
      title: readNonBlankString(item.title) || 'Article Lightfunnels',
      sku: readNonBlankString(item.sku) || '',
      productId: readNonBlankString(item.product_id) || '',
      variantId: readNonBlankString(item.variant_id) || '',
      unitPrice: Number.isFinite(Number(item.price)) ? Number(item.price) : 0,
      optionsLabel,
    })
  }

  return lines
}



