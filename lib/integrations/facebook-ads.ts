import crypto from 'crypto'

const FACEBOOK_GRAPH_API_BASE = 'https://graph.facebook.com/v23.0'
const FACEBOOK_SCOPES = ['ads_read', 'business_management']

type FacebookOAuthStatePayload = {
  userId: string
  ts: number
  accessToken?: string
}

function buildGraphUrl(path: string, searchParams?: Record<string, string>) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const url = new URL(`${FACEBOOK_GRAPH_API_BASE}${normalizedPath}`)
  Object.entries(searchParams || {}).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value)
  })
  return url
}

export function createFacebookAdsOAuthState(payload: FacebookOAuthStatePayload, secret: string) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url')
  return `${encodedPayload}.${signature}`
}

export function parseFacebookAdsOAuthState(rawState: string, secret: string, maxAgeSeconds = 15 * 60) {
  const [encodedPayload, receivedSignature] = String(rawState || '').split('.')
  if (!encodedPayload || !receivedSignature) return null

  const expectedSignature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url')
  const receivedBuffer = Buffer.from(receivedSignature)
  const expectedBuffer = Buffer.from(expectedSignature)
  if (receivedBuffer.length !== expectedBuffer.length) return null
  if (!crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) return null

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as FacebookOAuthStatePayload
    if (!payload.userId || typeof payload.ts !== 'number') return null
    if (Date.now() - payload.ts > maxAgeSeconds * 1000) return null
    return payload
  } catch {
    return null
  }
}

export function buildFacebookAdsAuthorizeUrl(params: {
  clientId: string
  redirectUri: string
  state: string
}) {
  const url = new URL('https://www.facebook.com/v23.0/dialog/oauth')
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('state', params.state)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', FACEBOOK_SCOPES.join(','))
  return url.toString()
}

export async function exchangeFacebookCodeForToken(params: {
  clientId: string
  clientSecret: string
  redirectUri: string
  code: string
}) {
  const url = buildGraphUrl('/oauth/access_token', {
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    code: params.code,
  })

  const response = await fetch(url.toString())
  if (!response.ok) throw new Error(`FACEBOOK_TOKEN_EXCHANGE_FAILED:${await response.text()}`)
  return response.json() as Promise<{ access_token?: string; token_type?: string; expires_in?: number }>
}

export async function exchangeFacebookLongLivedToken(params: {
  clientId: string
  clientSecret: string
  accessToken: string
}) {
  const url = buildGraphUrl('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: params.clientId,
    client_secret: params.clientSecret,
    fb_exchange_token: params.accessToken,
  })

  const response = await fetch(url.toString())
  if (!response.ok) throw new Error(`FACEBOOK_LONG_LIVED_TOKEN_FAILED:${await response.text()}`)
  return response.json() as Promise<{ access_token?: string; token_type?: string; expires_in?: number }>
}

export async function fetchFacebookGraph<T>(params: {
  path: string
  accessToken: string
  searchParams?: Record<string, string>
}) {
  const url = buildGraphUrl(params.path, params.searchParams)
  url.searchParams.set('access_token', params.accessToken)

  const response = await fetch(url.toString(), { method: 'GET' })
  if (!response.ok) throw new Error(`FACEBOOK_GRAPH_REQUEST_FAILED:${await response.text()}`)
  return response.json() as Promise<T>
}

export async function getFacebookUser(accessToken: string) {
  return fetchFacebookGraph<{ id?: string; name?: string }>({
    path: '/me',
    accessToken,
    searchParams: { fields: 'id,name' },
  })
}

export async function listFacebookAdAccounts(accessToken: string) {
  const payload = await fetchFacebookGraph<{ data?: Array<any> }>({
    path: '/me/adaccounts',
    accessToken,
    searchParams: {
      fields: 'id,name,account_currency,timezone_name,timezone_offset_hours_utc,account_status',
      limit: '500',
    },
  })

  return (payload.data || []).map((row) => ({
    accountId: String(row.id || '').replace(/^act_/, ''),
    accountName: String(row.name || 'Facebook Ad Account'),
    accountCurrency: String(row.account_currency || 'USD').toUpperCase(),
    timezoneName: row.timezone_name ? String(row.timezone_name) : null,
    timezoneOffsetHours: Number.isFinite(Number(row.timezone_offset_hours_utc)) ? Number(row.timezone_offset_hours_utc) : null,
    isActive: Number(row.account_status || 1) === 1,
  })).filter((row) => row.accountId)
}

export async function listFacebookCampaigns(params: { accessToken: string; accountId: string }) {
  const payload = await fetchFacebookGraph<{ data?: Array<any> }>({
    path: `/act_${params.accountId}/campaigns`,
    accessToken: params.accessToken,
    searchParams: {
      fields: 'id,name,effective_status,status',
      limit: '500',
    },
  })

  return (payload.data || []).map((row) => ({
    id: String(row.id || ''),
    name: String(row.name || 'Campaign'),
    effectiveStatus: String(row.effective_status || row.status || ''),
  })).filter((row) => row.id)
}

function extractActionValue(actions: any[] | undefined, actionType: string): number {
  if (!Array.isArray(actions)) return 0
  const action = actions.find((a) => a.action_type === actionType)
  return action ? Number(action.value || 0) : 0
}

export async function getFacebookCampaignInsights(params: {
  accessToken: string
  accountId: string
  campaignIds: string[]
  dateFrom: string
  dateTo: string
}) {
  const filtering = params.campaignIds.length > 0
    ? JSON.stringify([
        {
          field: 'campaign.id',
          operator: 'IN',
          value: params.campaignIds,
        },
      ])
    : undefined

  const payload = await fetchFacebookGraph<{ data?: Array<any> }>({
    path: `/act_${params.accountId}/insights`,
    accessToken: params.accessToken,
    searchParams: {
      level: 'campaign',
      fields: [
        'campaign_id',
        'campaign_name',
        'spend',
        'date_start',
        'date_stop',
        'account_id',
        'impressions',
        'clicks',
        'reach',
        'frequency',
        'cpc',
        'cpm',
        'cpp',
        'ctr',
        'actions',
        'action_values',
        'cost_per_action_type',
        'outbound_clicks',
        'outbound_clicks_ctr',
        'video_30_sec_watched_actions',
        'video_avg_time_watched_actions',
      ].join(','),
      time_increment: '1',
      time_range: JSON.stringify({ since: params.dateFrom, until: params.dateTo }),
      limit: '500',
      ...(filtering ? { filtering } : {}),
    },
  })

  return (payload.data || []).map((row) => ({
    accountId: String(row.account_id || params.accountId).replace(/^act_/, ''),
    campaignId: String(row.campaign_id || ''),
    campaignName: String(row.campaign_name || 'Campaign'),
    spend: Number(row.spend || 0),
    dateStart: String(row.date_start || ''),
    dateStop: String(row.date_stop || row.date_start || ''),
    // Métriques de performance
    impressions: Number(row.impressions || 0),
    clicks: Number(row.clicks || 0),
    reach: Number(row.reach || 0),
    frequency: Number(row.frequency || 0),
    // Métriques de coût
    cpc: Number(row.cpc || 0),
    cpm: Number(row.cpm || 0),
    cpp: Number(row.cpp || 0),
    ctr: Number(row.ctr || 0),
    // Conversions
    actions: row.actions as any[] | undefined,
    actionValues: row.action_values as any[] | undefined,
    costPerActionType: row.cost_per_action_type as any[] | undefined,
    // Engagement
    outboundClicks: Number(row.outbound_clicks || 0),
    outboundClicksCtr: Number(row.outbound_clicks_ctr || 0),
    // Vidéo
    video30SecWatched: Number(row.video_30_sec_watched_actions?.[0]?.value || 0),
    videoAvgTimeWatched: Number(row.video_avg_time_watched_actions?.[0]?.value || 0),
    // Métriques extraites
    purchases: extractActionValue(row.actions, 'purchase'),
    addToCart: extractActionValue(row.actions, 'add_to_cart'),
    initiateCheckout: extractActionValue(row.actions, 'initiate_checkout'),
    viewContent: extractActionValue(row.actions, 'view_content'),
    postEngagement: extractActionValue(row.actions, 'post_engagement'),
    pageEngagement: extractActionValue(row.actions, 'page_engagement'),
    linkClicks: extractActionValue(row.actions, 'link_click'),
    conversionValue: extractActionValue(row.action_values, 'purchase'),
    actionsTotal: (row.actions as any[] | undefined)?.reduce((sum: number, a: any) => sum + Number(a.value || 0), 0) || 0,
  })).filter((row) => row.campaignId && row.dateStart)
}
