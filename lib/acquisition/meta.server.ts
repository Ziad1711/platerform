import 'server-only'
import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { FACEBOOK_GRAPH_API_BASE, exchangeFacebookCodeForToken, exchangeFacebookLongLivedToken } from '@/lib/integrations/facebook-ads'
import { isQualificationMode, LEGACY_Q4_HOST, supabaseHost } from '@/lib/env/qualification-guard'
import { decryptSecret, encryptSecret, isEncryptedSecret } from '@/lib/security/crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { metaObjectId } from './touch'

export const acquisitionPath = '/admin/marketing/acquisition'
export const oauthPath = '/api/admin/acquisition/callback'
const levels = ['campaign', 'adset', 'ad'] as const
const id = z.string().regex(metaObjectId)

export function acquisitionConfig() {
  if (isQualificationMode() || supabaseHost() === LEGACY_Q4_HOST || process.env.JISRA_Q4_RUNNER === '1' ||
    (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production')) return null
  const account = (process.env.JISRA_META_AD_ACCOUNT_ID ?? '').replace(/^act_/, '')
  const clientId = process.env.JISRA_META_ADS_APP_ID || process.env.FACEBOOK_APP_ID
  const clientSecret = process.env.JISRA_META_ADS_APP_SECRET || process.env.FACEBOOK_APP_SECRET
  const app = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_ENV === 'production' ? 'https://jisra.io' : '')
  if (!metaObjectId.test(account) || !clientId || !clientSecret || !app ||
    Boolean(process.env.JISRA_META_ADS_APP_ID) !== Boolean(process.env.JISRA_META_ADS_APP_SECRET) ||
    Buffer.from(process.env.INTEGRATIONS_ENCRYPTION_KEY ?? '', 'base64').length !== 32) return null
  try {
    const url = new URL(app)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return { account, clientId, clientSecret, origin: url.origin, redirectUri: new URL(oauthPath, url.origin).href }
  } catch { return null }
}

type Config = NonNullable<ReturnType<typeof acquisitionConfig>>
type ErrorCode = 'TOKEN_EXPIRED' | 'ACCESS_DENIED' | 'RATE_LIMIT' | 'GRAPH_FAILED' | 'GRAPH_DATA' | 'SYNC_FAILED'
export class AcquisitionError extends Error {
  constructor(readonly code: ErrorCode, readonly graphCode?: number) { super(code) }
}

async function graph(path: string, token: string, secret: string, params: Record<string, string>, signal: AbortSignal) {
  const url = new URL(`${FACEBOOK_GRAPH_API_BASE}${path}`)
  url.search = new URLSearchParams(params).toString()
  url.searchParams.set('appsecret_proof', createHmac('sha256', secret).update(token).digest('hex'))
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error', signal })
  const payload = await response.json().catch(() => null)
  const code = Number(payload?.error?.code)
  if (response.status === 429 || [4, 17, 32, 613, 80004].includes(code)) throw new AcquisitionError('RATE_LIMIT')
  if ([102, 190].includes(code) || response.status === 401) throw new AcquisitionError('TOKEN_EXPIRED')
  if ([10, 200, 294].includes(code) || response.status === 403) throw new AcquisitionError('ACCESS_DENIED')
  if (!response.ok || !payload || payload.error) throw new AcquisitionError('GRAPH_FAILED', code)
  return payload as unknown
}

async function pages(path: string, token: string, secret: string, params: Record<string, string>, signal: AbortSignal) {
  const rows: unknown[] = []
  let after: string | undefined
  for (let page = 0; page < 40; page++) {
    const result = z.object({ data: z.array(z.unknown()), paging: z.object({
      next: z.string().optional(), cursors: z.object({ after: z.string().max(4096).optional() }).optional(),
    }).optional() }).parse(await graph(path, token, secret, { ...params, ...(after ? { after } : {}) }, signal))
    rows.push(...result.data)
    if (!result.paging?.next) return rows
    const next = result.paging.cursors?.after
    if (!next || next === after) break
    after = next // Never fetch a provider-supplied URL that may contain an access token.
  }
  throw new AcquisitionError('GRAPH_DATA')
}

export async function activateAcquisition(config: Config, code: string) {
  const short = await exchangeFacebookCodeForToken({ ...config, code, safe: true })
  if (!short.access_token) throw new AcquisitionError('ACCESS_DENIED')
  const long = await exchangeFacebookLongLivedToken({ ...config, accessToken: short.access_token, safe: true })
  const token = long.access_token
  if (!token || isEncryptedSecret(token) || !Number.isSafeInteger(long.expires_in) || long.expires_in! <= 0) throw new AcquisitionError('TOKEN_EXPIRED')
  const signal = AbortSignal.timeout(10000)
  const path = `/act_${config.account}`
  const accountFields = 'account_id,name,currency,timezone_name'
  const [identity, permissions, account] = await Promise.all([
    graph('/me', token, config.clientSecret, { fields: 'id' }, signal),
    pages('/me/permissions', token, config.clientSecret, { limit: '100' }, signal),
    graph(path, token, config.clientSecret, { fields: `${accountFields},user_tasks` }, signal).catch(error => {
      // Some account types/API configurations do not expose this field.
      if (!(error instanceof AcquisitionError) || error.graphCode !== 100) throw error
      return graph(path, token, config.clientSecret, { fields: accountFields }, signal)
    }),
  ])
  if (!permissions.some(entry => z.object({ permission: z.literal('ads_read'), status: z.literal('granted') }).safeParse(entry).success)) {
    throw new AcquisitionError('ACCESS_DENIED')
  }
  const user = z.object({ id }).parse(identity)
  const ad = z.object({ account_id: id, name: z.string().min(1).max(512), currency: z.string().regex(/^[A-Z]{3}$/),
    timezone_name: z.string().min(1).max(100), user_tasks: z.array(z.string().max(64)).max(50).optional() }).parse(account)
  if (ad.account_id !== config.account) throw new AcquisitionError('ACCESS_DENIED')
  // Practical permission check even when Meta does not return task metadata.
  z.object({ data: z.array(z.unknown()) }).parse(await graph(`${path}/insights`, token, config.clientSecret,
    { level: 'account', fields: 'spend', date_preset: 'yesterday', limit: '1' }, signal))
  const { data, error } = await createAdminClient().rpc('rpc_acquisition_connect', {
    p_account: config.account, p_name: ad.name, p_meta_user: user.id, p_tasks: ad.user_tasks ?? [], p_currency: ad.currency,
    p_tz: ad.timezone_name, p_token: encryptSecret(token), p_expires: new Date(Date.now() + long.expires_in! * 1000).toISOString(),
  })
  if (error || data !== true) throw new AcquisitionError('SYNC_FAILED')
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const claimSchema = z.object({ account: id, currency: z.string(), token: z.string().startsWith('v1:'), lease: z.string().uuid(), from: day, to: day, inventory: z.boolean() })
const insightsSchema = z.object({ account_id: id, account_currency: z.string(), date_start: day, date_stop: day,
  campaign_id: id, adset_id: id.optional(), ad_id: id.optional(),
  campaign_name: z.string(), adset_name: z.string().optional(), ad_name: z.string().optional(),
  spend: z.string().regex(/^\d{1,18}(\.\d{1,12})?$/), impressions: z.string().regex(/^\d{1,18}$/), clicks: z.string().regex(/^\d{1,18}$/),
})

export async function syncAcquisition(config: Config) {
  const db = createAdminClient()
  const { data, error } = await db.rpc('rpc_acquisition_claim', { p_account: config.account })
  if (error) throw new AcquisitionError('SYNC_FAILED')
  if (!data) return 'idle'
  const claim = claimSchema.parse(data)
  let failure: ErrorCode | null = null
  let rows: unknown[] = []
  try {
    const token = decryptSecret(claim.token)
    const signal = AbortSignal.timeout(38000)
    const insights = levels.map(async level => {
      const identity = ['campaign', ...(level === 'campaign' ? [] : ['adset']), ...(level === 'ad' ? ['ad'] : [])]
      const result = await pages(`/act_${claim.account}/insights`, token, config.clientSecret, {
        level, fields: ['account_id', 'account_currency', 'spend', 'impressions', 'clicks', 'date_start', 'date_stop',
          ...identity.flatMap(key => [`${key}_id`, `${key}_name`])].join(','), time_increment: '1',
        time_range: JSON.stringify({ since: claim.from, until: claim.to }), limit: '500',
      }, signal)
      return result.map(raw => {
        const r = insightsSchema.parse(raw)
        const object_id = r[`${level}_id`]
        const name = r[`${level}_name`]
        if (r.account_id !== claim.account || r.account_currency !== claim.currency || !object_id || !name ||
          (level === 'ad' && !r.adset_id) || r.date_start !== r.date_stop || r.date_start < claim.from || r.date_start > claim.to) {
          throw new AcquisitionError('GRAPH_DATA')
        }
        return { level, object_id, name, campaign_id: r.campaign_id, adset_id: r.adset_id, day: r.date_start,
          spend: r.spend, impressions: r.impressions, clicks: r.clicks }
      })
    })
    const inventory = claim.inventory ? levels.map(async level => {
      const edge = { campaign: 'campaigns', adset: 'adsets', ad: 'ads' }[level]
      const fields = ['id', 'name', ...(level === 'campaign' ? [] : ['campaign_id']), ...(level === 'ad' ? ['adset_id'] : [])]
      const catalog = await pages(`/act_${claim.account}/${edge}`, token, config.clientSecret, { fields: fields.join(','), limit: '500' }, signal)
      return catalog.map(raw => {
        const r = z.object({ id, name: z.string().min(1), campaign_id: id.optional(), adset_id: id.optional() }).parse(raw)
        if ((level !== 'campaign' && !r.campaign_id) || (level === 'ad' && !r.adset_id)) throw new AcquisitionError('GRAPH_DATA')
        return { level, object_id: r.id, name: r.name, campaign_id: r.campaign_id, adset_id: r.adset_id }
      })
    }) : []
    rows = (await Promise.all([...inventory, ...insights])).flat()
  } catch (err) { failure = err instanceof AcquisitionError ? err.code : err instanceof z.ZodError ? 'GRAPH_DATA' : 'SYNC_FAILED' }
  const finish = await db.rpc('rpc_acquisition_finish', { p_lease: claim.lease, p_from: claim.from, p_to: claim.to, p_rows: rows, p_error: failure })
  if (finish.error || finish.data !== true) throw new AcquisitionError('SYNC_FAILED')
  if (failure) throw new AcquisitionError(failure)
  return 'synced'
}