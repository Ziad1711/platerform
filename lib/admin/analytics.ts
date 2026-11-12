import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'

export type GaConfig = { propertyId: string; email: string; privateKey: string }
export type AnalyticsSource = 'ga4' | 'synthetic'
export type AnalyticsReportStatus = 'ok' | 'unavailable' | 'error' | 'quota'
export type CachedReport = {
  report: string; status: AnalyticsReportStatus; payload: unknown; source: AnalyticsSource
  fetched_at: string; expires_at: string; error_code: string | null; fresh: boolean
}
export type CommercialFunnel = {
  accounts_created: number; payment_requests_created: number; paid_activations: number
  paid_activations_currency: { currency: string; amount_minor: number; count: number }[]
}
export type AnalyticsOverview = {
  from: string; until: string; source: AnalyticsSource; reports: CachedReport[]
  last_sync: string | null; external_calls_enabled: false; coverage: Record<string, string>
  commercial: CommercialFunnel; configured: boolean
}

/** Lit uniquement un JSON de compte de service ; jamais une clé côté client. */
export function readGaConfig(env: NodeJS.ProcessEnv = process.env): GaConfig | null {
  const propertyId = (env.GA4_PROPERTY_ID || '').trim()
  const raw = (env.GA4_SERVICE_ACCOUNT_JSON || '').trim()
  if (!/^\d{4,20}$/.test(propertyId) || !raw) return null
  try {
    const key = JSON.parse(raw) as Record<string, unknown>
    if (typeof key.client_email !== 'string' || !key.client_email.includes('@')
      || typeof key.private_key !== 'string' || !key.private_key.startsWith('-----BEGIN PRIVATE KEY-----')) return null
    return { propertyId, email: key.client_email, privateKey: key.private_key }
  } catch { return null }
}

/** Hors qualification : toute erreur est journalisée par le serveur, jamais renvoyée au client. */
export function ga4ExternalCallsAllowed(env: NodeJS.ProcessEnv = process.env) {
  return env.JISRA_QUALIFICATION !== '1' && env.GA4_EXTERNAL_CALLS === 'enabled'
}

export const reportWindow = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.enum(['ga4', 'synthetic']).default('ga4'),
}).superRefine((value, ctx) => {
  if (value.until <= value.from) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_period' })
})

export async function readAnalyticsCache(from: string, until: string, source: AnalyticsSource) {
  const { data, error } = await createAdminClient().rpc('rpc_admin_analytics_read', {
    p_from: from, p_until: until, p_source: source,
  })
  if (error) throw new Error('ADMIN_UNAVAILABLE')
  if (data?.error) throw new Error(data.error)
  return data
}

/** Écriture réservée au serveur (service_role) : le cache ne vient jamais du navigateur. */
export async function storeAnalyticsReport(input: {
  key: string; from: string; until: string; status: AnalyticsReportStatus; source: AnalyticsSource
  payload: unknown; errorCode?: string | null; ttlMinutes: number
}) {
  const payloadText = input.payload === null ? null : JSON.stringify(input.payload)
  const { error } = await createAdminClient().from('analytics_reports').upsert({
    report_key: input.key, period_start: input.from, period_end: input.until, status: input.status,
    source: input.source, payload: input.payload,
    payload_sha256: payloadText ? createHash('sha256').update(payloadText).digest('hex') : null,
    error_code: input.errorCode || null, fetched_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + input.ttlMinutes * 60_000).toISOString(),
  }, { onConflict: 'report_key,period_start,period_end' })
  if (error) throw new Error('ADMIN_UNAVAILABLE')
}

export async function readCommercialFunnel(from: string, until: string): Promise<CommercialFunnel> {
  const { data, error } = await createAdminClient().rpc('rpc_admin_commercial_funnel', { p_from: from, p_until: until })
  if (error) throw new Error('ADMIN_UNAVAILABLE')
  return data as CommercialFunnel
}
