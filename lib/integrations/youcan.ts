import crypto from 'crypto'

const YOUCAN_SCOPE = '*'
const YOUCAN_API_BASE_URL = 'https://api.youcan.shop'

function isLocalhostHost(hostname: string) {
  const normalized = String(hostname || '').trim().toLowerCase()
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized.endsWith('.localhost')
  )
}

function getYouCanStoreBaseUrl(store: string) {
  const normalizedStore = normalizeYouCanStore(store)
  return `https://${normalizedStore}.youcan.shop`
}

export function normalizeYouCanStore(store: string) {
  const normalized = store.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')

  if (normalized.endsWith('.youcan.shop')) {
    return normalized.replace('.youcan.shop', '')
  }

  if (normalized.includes('.')) {
    return normalized.split('.')[0]
  }

  return normalized
}

export function resolveYouCanPublicBaseUrl(params: {
  requestUrl: string
  configuredRedirectUri?: string
}) {
  const warnings: string[] = []
  const configuredRedirectUri = String(params.configuredRedirectUri || '').trim()

  if (configuredRedirectUri) {
    try {
      const configuredUrl = new URL(configuredRedirectUri)
      if (isLocalhostHost(configuredUrl.hostname)) {
        warnings.push('YOUCAN_REDIRECT_URI points to localhost; YouCan webhooks cannot reach localhost directly.')
      }

      return {
        origin: configuredUrl.origin,
        source: 'configured_redirect_uri' as const,
        warnings,
      }
    } catch {
      warnings.push('YOUCAN_REDIRECT_URI is invalid.')
    }
  }

  const requestOrigin = new URL(params.requestUrl).origin
  const requestHostname = new URL(params.requestUrl).hostname

  if (isLocalhostHost(requestHostname)) {
    warnings.push('Current request origin is localhost; YouCan webhooks need a public HTTPS URL.')
  }

  return {
    origin: requestOrigin,
    source: 'request_origin' as const,
    warnings,
  }
}

export function buildYouCanAuthorizeUrl(params: {
  store: string
  clientId: string
  redirectUri: string
  state?: string
}) {
  const url = new URL('https://seller-area.youcan.shop/admin/oauth/authorize')

  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('scope', YOUCAN_SCOPE)
  if (params.state) {
    url.searchParams.set('state', params.state)
  }

  return url.toString()
}

export async function exchangeYouCanCodeForToken(params: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri?: string
}) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
  })

  if (params.redirectUri) {
    body.set('redirect_uri', params.redirectUri)
  }

  const response = await fetch(`${YOUCAN_API_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`YOUCAN_TOKEN_EXCHANGE_FAILED:${body}`)
  }

  return response.json() as Promise<{
    access_token?: string
    refresh_token?: string | null
  }>
}

type YouCanPaginatedResponse<T> = {
  data?: T[]
  meta?: {
    pagination?: {
      current_page?: number
      total_pages?: number
      links?: {
        next?: string
      }
    }
  }
}

export type YouCanRestHookRecord = {
  id?: string
  event?: string
  target_url?: string
  targetUrl?: string
}

export async function listYouCanProducts(params: {
  accessToken: string
  page?: number
}) {
  const url = new URL(`${YOUCAN_API_BASE_URL}/products`)
  url.searchParams.set('include', 'variants,images')
  url.searchParams.set('page', String(params.page || 1))

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`YOUCAN_LIST_PRODUCTS_FAILED:${body}`)
  }

  return response.json() as Promise<YouCanPaginatedResponse<any>>
}

export async function listYouCanOrders(params: {
  accessToken: string
  page?: number
}) {
  const url = new URL(`${YOUCAN_API_BASE_URL}/orders`)
  url.searchParams.set('include', 'customer,variants,payment,shipping')
  url.searchParams.set('page', String(params.page || 1))

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`YOUCAN_LIST_ORDERS_FAILED:${body}`)
  }

  return response.json() as Promise<YouCanPaginatedResponse<any>>
}

export async function subscribeYouCanRestHook(params: {
  accessToken: string
  event: 'order.create' | 'inventory.low' | 'upsell.accept'
  targetUrl: string
}) {
  const response = await fetch(`${YOUCAN_API_BASE_URL}/resthooks/subscribe`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      event: params.event,
      target_url: params.targetUrl,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`YOUCAN_SUBSCRIBE_REST_HOOK_FAILED:${body}`)
  }

  return response.json() as Promise<{ id?: string }>
}

export async function listYouCanRestHooks(params: { accessToken: string }) {
  const candidateUrls = [
    `${YOUCAN_API_BASE_URL}/resthooks/list`,
    `${YOUCAN_API_BASE_URL}/resthooks`,
    `${YOUCAN_API_BASE_URL}/resthooks/subscriptions`,
  ]
  let lastError = 'YOUCAN_LIST_REST_HOOKS_FAILED'

  for (const url of candidateUrls) {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: 'application/json',
      },
    })

    if (response.ok) {
      const payload = (await response.json().catch(() => null)) as any
      const rows = extractYouCanRestHookRows(payload)

      return rows as YouCanRestHookRecord[]
    }

    lastError = await response.text()
  }

  throw new Error(`YOUCAN_LIST_REST_HOOKS_FAILED:${lastError}`)
}

function extractYouCanRestHookRows(payload: any) {
  const rows: YouCanRestHookRecord[] = []
  const seen = new Set<string>()

  function visit(value: any) {
    if (!value) return

    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }

    if (typeof value !== 'object') return


    const event = String(value.event || '').trim()
    const targetUrl = getYouCanRestHookTargetUrl(value)
    const id = String(value.id || '').trim()

    if (event || targetUrl || id) {
      const key = `${id}:${event}:${targetUrl}`
      if (!seen.has(key)) {
        seen.add(key)
        rows.push(value as YouCanRestHookRecord)
      }
    }

    for (const child of Object.values(value)) visit(child)
  }

  visit(payload)
  return rows
}

export async function deleteYouCanRestHook(params: { accessToken: string; subscriptionId: string }) {
  const candidateUrls = [
    `${YOUCAN_API_BASE_URL}/resthooks/${encodeURIComponent(params.subscriptionId)}`,
    `${YOUCAN_API_BASE_URL}/resthooks/unsubscribe/${encodeURIComponent(params.subscriptionId)}`,
  ]
  let lastError = 'YOUCAN_DELETE_REST_HOOK_FAILED'

  for (const url of candidateUrls) {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: 'application/json',
      },
    })

    if (response.ok) {
      return true
    }

    lastError = await response.text()
  }

  throw new Error(`YOUCAN_DELETE_REST_HOOK_FAILED:${lastError}`)
}

export function getYouCanRestHookTargetUrl(hook: YouCanRestHookRecord) {
  return String(hook.target_url || hook.targetUrl || '').trim()
}

export function verifyYouCanHmac(requestUrl: string, clientSecret: string) {
  const url = new URL(requestUrl)
  const queryString = url.search.startsWith('?') ? url.search.slice(1) : url.search
  if (!queryString) return false

  const params = new URLSearchParams(queryString)
  const receivedHmac = params.get('hmac')
  if (!receivedHmac) return false

  params.delete('hmac')

  const message = params.toString()
  const expectedHmac = crypto.createHmac('sha256', clientSecret).update(message).digest('hex')

  const receivedBuffer = Buffer.from(receivedHmac, 'hex')
  const expectedBuffer = Buffer.from(expectedHmac, 'hex')

  if (receivedBuffer.length !== expectedBuffer.length) return false
  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
}

export function verifyYouCanWebhookSignature(params: {
  signature: string
  rawBody: string
  clientSecret: string
}) {
  const normalizedSignature = String(params.signature || '')
    .trim()
    .replace(/^sha256=/i, '')
    .toLowerCase()

  if (!/^[a-f0-9]{64}$/.test(normalizedSignature)) return false

  const expectedFromRawBody = crypto
    .createHmac('sha256', params.clientSecret)
    .update(params.rawBody)
    .digest('hex')

  const receivedBuffer = Buffer.from(normalizedSignature, 'hex')
  const rawBodyBuffer = Buffer.from(expectedFromRawBody, 'hex')

  if (
    receivedBuffer.length === rawBodyBuffer.length &&
    crypto.timingSafeEqual(receivedBuffer, rawBodyBuffer)
  ) {
    return true
  }

  // Fallback robuste: certains providers signent le JSON canonique.
  // On tente JSON.parse + JSON.stringify pour couvrir ce cas.
  try {
    const canonicalBody = JSON.stringify(JSON.parse(params.rawBody || '{}'))
    const expectedFromCanonicalBody = crypto
      .createHmac('sha256', params.clientSecret)
      .update(canonicalBody)
      .digest('hex')

    const canonicalBodyBuffer = Buffer.from(expectedFromCanonicalBody, 'hex')
    if (receivedBuffer.length !== canonicalBodyBuffer.length) return false
    return crypto.timingSafeEqual(receivedBuffer, canonicalBodyBuffer)
  } catch {
    return false
  }
}

type YouCanOAuthStatePayload = {
  userId: string
  store: string
  ts: number
  accessToken?: string
}

export function createYouCanOAuthState(payload: YouCanOAuthStatePayload, secret: string) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url')
  return `${encodedPayload}.${signature}`
}

export function parseYouCanOAuthState(
  rawState: string,
  secret: string,
  maxAgeSeconds = 15 * 60
) {
  const [encodedPayload, receivedSignature] = rawState.split('.')
  if (!encodedPayload || !receivedSignature) return null

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url')

  const receivedBuffer = Buffer.from(receivedSignature)
  const expectedBuffer = Buffer.from(expectedSignature)
  if (receivedBuffer.length !== expectedBuffer.length) return null
  if (!crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) return null

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf-8')) as {
      userId?: string
      store?: string
      ts?: number
    }

    if (!payload.userId || !payload.store || typeof payload.ts !== 'number') return null
    const now = Date.now()
    if (now - payload.ts > maxAgeSeconds * 1000) return null

    return {
      userId: payload.userId,
      store: payload.store,
      ts: payload.ts,
      accessToken: typeof (payload as { accessToken?: unknown }).accessToken === 'string'
        ? (payload as { accessToken?: string }).accessToken
        : undefined,
    }
  } catch {
    return null
  }
}
