import 'server-only'
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { isQualificationMode, LEGACY_Q4_HOST, supabaseHost } from '@/lib/env/qualification-guard'
import { META_CONSENT_COOKIE, META_PIXEL_ID, metaEnabled, type MetaEvent } from './meta-config'
import { sendMetaPayload } from './meta-transport.mjs'

export const metaId = z.string().uuid()
const token = () => process.env.META_CAPI_ACCESS_TOKEN?.trim()

export function metaRuntimeEnabled() {
  return metaEnabled() && process.env.META_CAPI_ENABLED === '1' && Boolean(token()) &&
    !isQualificationMode() && process.env.JISRA_Q4_RUNNER !== '1' &&
    supabaseHost() !== LEGACY_Q4_HOST && (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === 'production')
}

export function metaSameOrigin(request: Request) {
  return request.headers.get('origin') === new URL(request.url).origin &&
    request.headers.get('sec-fetch-site') !== 'cross-site'
}

export async function metaConsentId() {
  if (!metaRuntimeEnabled()) return null
  try {
    const result = metaId.safeParse((await cookies()).get(META_CONSENT_COOKIE)?.value)
    return result.success ? result.data : null
  } catch { return null }
}

export async function metaBrowserMatch(request: Request) {
  const jar = await cookies()
  const matching: Record<string, string> = {}
  for (const key of ['fbp', 'fbc'] as const) {
    const val = jar.get(`_${key}`)?.value
    if (val && /^fb\.\d{1,3}\.\d{10,16}\.[a-zA-Z0-9_-]{1,250}$/.test(val)) matching[key] = val
  }
  // A consenting landing page can supply a Meta click ID before the Pixel sets _fbc.
  const referrer = request.headers.get('referer')
  if (referrer && referrer.length <= 4096) {
    try {
      const url = new URL(referrer)
      const click = url.origin === new URL(request.url).origin && url.searchParams.get('fbclid')
      if (click && /^[a-zA-Z0-9_-]{1,250}$/.test(click) && !matching.fbc?.endsWith(`.${click}`)) {
        matching.fbc = `fb.1.${Date.now()}.${click}`
      }
    } catch { /* no usable referrer */ }
  }
  const agent = request.headers.get('user-agent')
  if (agent) matching.client_user_agent = agent.slice(0, 512)
  const forwarded = process.env.VERCEL === '1' ? request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() : null
  if (forwarded && isIP(forwarded)) matching.client_ip_address = forwarded
  return matching
}

type OutboxEvent = {
  id: string; lease: number; event_name: MetaEvent; occurred_at: string; path: string
  user_id: string | null; matching: Record<string, string>
}

export async function postMetaEvent(event: OutboxEvent) {
  if (!metaRuntimeEnabled()) return false
  const externalId = event.user_id && createHash('sha256').update(`jisra:${event.user_id}`).digest('hex')
  const result = await sendMetaPayload({ pixel: META_PIXEL_ID, token: token(), testCode: undefined, event: {
    event_name: event.event_name, event_id: event.id, action_source: 'website',
    event_time: Math.floor(Date.parse(event.occurred_at) / 1000), event_source_url: new URL(event.path, 'https://jisra.io').href,
    user_data: { ...event.matching, ...(externalId ? { external_id: [externalId] } : {}) },
  } })
  return result.ok
}

export async function drainMetaOutbox(subscriptionId?: string) {
  if (!metaRuntimeEnabled()) return { disabled: true }
  const db = createAdminClient()
  const claim = await db.rpc('rpc_meta_claim', { p_subscription: subscriptionId ?? null }).abortSignal(AbortSignal.timeout(3000))
  if (claim.error) throw new Error('META_CLAIM_FAILED')
  const events = claim.data as OutboxEvent[]
  const results = await Promise.allSettled(events.map(async (event) => {
    const permitted = await db.rpc('rpc_meta_can_send', { p_event: event.id, p_lease: event.lease }).abortSignal(AbortSignal.timeout(3000))
    if (permitted.error) throw new Error('META_PERMISSION_CHECK_FAILED')
    if (permitted.data !== true) return false
    if (!await postMetaEvent(event)) return false // The existing lease makes it eligible for retry in five minutes.
    const result = await db.rpc('rpc_meta_finish', { p_event: event.id, p_lease: event.lease, p_sent: true }).abortSignal(AbortSignal.timeout(3000))
    if (result.error) throw new Error('META_FINISH_FAILED')
    return true
  }))
  if (results.some(result => result.status === 'rejected')) throw new Error('META_DRAIN_INCOMPLETE')
  const sent = results.filter(result => result.status === 'fulfilled' && result.value).length
  return { claimed: events.length, sent, deferred: events.length - sent }
}