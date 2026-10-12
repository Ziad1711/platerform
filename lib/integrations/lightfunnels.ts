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
 * Scopes demandés : `orders` pour lire les commandes, `funnels` pour lire les boutiques du
 * compte (la documentation rattache `account.stores` au scope `funnels`) — sans lui, la
 * liaison des boutiques échoue alors que le consentement a été accepté.
 * Référence : https://developer.lightfunnels.com/scopes
 */
export const LIGHTFUNNELS_SCOPES = 'orders,funnels'

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
 * Requête GraphQL brute. Les erreurs applicatives arrivent avec un HTTP 200 :
 * le tableau `errors` est donc toujours remonté, sans être masqué par des données partielles.
 */
export async function lightfunnelsRawRequest<T = any>(params: {
  accessToken: string
  query: string
  variables?: Record<string, unknown>
}): Promise<LightfunnelsGraphqlResult<T>> {
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
    throw new Error(`LIGHTFUNNELS_HTTP_${response.status}:${raw.slice(0, 600)}`)
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

  return { data: (payload?.data ?? null) as T | null, errors }
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
 * `store_id` permet de rattacher chaque produit à sa boutique : sans lui, un compte
 * possédant plusieurs boutiques verrait leurs catalogues mélangés dans un même store Jisra.
 */
export const LIGHTFUNNELS_PRODUCT_STORE_ID_FIELD = `
        store_id`

function buildProductsQuery(options: { details: boolean; thumbnail: boolean; storeId: boolean }) {
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
        updated_at${thumbnail}${variants}${options.storeId ? LIGHTFUNNELS_PRODUCT_STORE_ID_FIELD : ''}
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
 * Combinaisons essayées pour les produits : champs détaillés + vignette + `store_id`, puis
 * de moins en moins de champs. La première combinaison acceptée est mémorisée, et
 * `storeIdAvailable` indique si la boutique distante a pu être vérifiée.
 */
const PRODUCT_QUERY_VARIANTS = [
  { details: true, thumbnail: true, storeId: true },
  { details: true, thumbnail: false, storeId: true },
  { details: false, thumbnail: false, storeId: true },
  { details: true, thumbnail: true, storeId: false },
  { details: true, thumbnail: false, storeId: false },
  { details: false, thumbnail: false, storeId: false },
]

let productQueryVariantIndex: number | null = null

/**
 * Liste paginée du catalogue (curseur). Filtres documentés : `order_by`, `order_dir`.
 * `storeIdAvailable` est faux quand le schéma installé n'expose pas `store_id` : l'appelant
 * refuse alors d'importer un compte multi-boutiques dans un store unique.
 */
export async function listLightfunnelsProducts(params: {
  accessToken: string
  first?: number
  after?: string | null
}) {
  const warnings: string[] = []
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

      if (!variant.storeId && !warnings.includes('PRODUCTS_WITHOUT_STORE_ID')) {
        warnings.push('PRODUCTS_WITHOUT_STORE_ID')
      }

      return {
        products: edges.map((edge: any) => edge?.node).filter((node: any) => Boolean(node?.id)),
        endCursor: pageInfo.endCursor ?? null,
        hasNextPage: Boolean(pageInfo.hasNextPage),
        storeIdAvailable: variant.storeId,
        warnings,
      }
    }

    warnings.push(`PRODUCTS_QUERY_FALLBACK:${result.errors.join(' | ')}`)
  }

  throw new Error('LIGHTFUNNELS_PRODUCTS_FETCH_FAILED')
}

/**
 * Détail d'une commande. Les adresses sont demandées en plus : si le schéma installé ne
 * les expose pas telles quelles, la requête est rejouée sans elles (l'import reste
 * fonctionnel et la raison est journalisée) plutôt que d'échouer.
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

function buildOrderDetailQuery(options: { includeAddresses: boolean; includeStoreId: boolean }) {
  return `query JisraOrderQuery($id: ID!) {
  node(id: $id) {
    ... on Order {
      ${LIGHTFUNNELS_ORDER_HEADLINE_FIELDS}${options.includeStoreId ? LIGHTFUNNELS_STORE_ID_FIELD : ''}
      ${LIGHTFUNNELS_ORDER_ITEMS_FIELDS}${options.includeAddresses ? LIGHTFUNNELS_ORDER_ADDRESS_FIELDS : ''}
    }
  }
}`
}

/**
 * Combinaisons de champs essayées dans l'ordre : adresses + `store_id`, puis sans l'un
 * et/ou l'autre. La combinaison retenue est mémorisée pour le reste du processus.
 */
const ORDER_DETAIL_VARIANTS = [
  { includeAddresses: true, includeStoreId: true },
  { includeAddresses: false, includeStoreId: true },
  { includeAddresses: false, includeStoreId: false },
]

let orderDetailVariantIndex: number | null = null

/**
 * Détail d'une commande. Les champs optionnels (adresses, `store_id`) sont demandés puis
 * abandonnés individuellement si le schéma installé ne les expose pas : l'import reste
 * fonctionnel et la raison est journalisée, plutôt qu'un échec silencieux.
 */
export async function getLightfunnelsOrder(params: {
  accessToken: string
  orderId: string
}) {
  const warnings: string[] = []
  const startIndex = orderDetailVariantIndex ?? 0

  for (let index = startIndex; index < ORDER_DETAIL_VARIANTS.length; index += 1) {
    const variant = ORDER_DETAIL_VARIANTS[index]

    const result = await lightfunnelsRawRequest<{ node?: any }>({
      accessToken: params.accessToken,
      query: buildOrderDetailQuery(variant),
      variables: { id: params.orderId },
    })

    if (result.errors.length === 0 && result.data?.node) {
      orderDetailVariantIndex = index
      return {
        order: result.data.node as any,
        addressesAvailable: variant.includeAddresses,
        storeIdAvailable: variant.includeStoreId,
        warnings,
      }
    }

    warnings.push(`ORDER_DETAIL_FALLBACK:${result.errors.join(' | ') || 'NO_DATA'}`)
  }

  throw new Error(`LIGHTFUNNELS_ORDER_FETCH_FAILED:${params.orderId}`)
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



