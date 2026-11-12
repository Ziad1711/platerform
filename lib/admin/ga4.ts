import 'server-only'
import { z } from 'zod'
import { ga4ExternalCallsAllowed, readGaConfig, storeAnalyticsReport, type AnalyticsReportStatus } from './analytics'

/** Rapports demandés. Dimensions à faible cardinalité uniquement. */
export const GA4_REPORTS = [
  { key: 'audience', dimensions: ['date'], metrics: ['totalUsers', 'newUsers', 'sessions', 'engagedSessions'] },
  { key: 'sources', dimensions: ['sessionSourceMedium'], metrics: ['sessions', 'totalUsers'] },
  { key: 'campaigns', dimensions: ['sessionCampaignName'], metrics: ['sessions', 'keyEvents'] },
  { key: 'pages', dimensions: ['pagePath'], metrics: ['screenPageViews', 'totalUsers'] },
  { key: 'events', dimensions: ['eventName'], metrics: ['eventCount', 'keyEvents'] },
] as const

const responseSchema = z.object({
  rows: z.array(z.object({
    dimensionValues: z.array(z.object({ value: z.string() })).min(1),
    metricValues: z.array(z.object({ value: z.string() })).min(1),
  })).default([]),
  rowCount: z.number().int().nonnegative().optional(),
})

export type GaReportData = { key: string; dimensions: string[]; metrics: string[]; rows: { dimensions: string[]; metrics: number[] }[]; totalRows: number }

class GaError extends Error {
  constructor(readonly kind: 'auth' | 'permission' | 'quota' | 'upstream' | 'invalid_response') { super(kind) }
}
function classify(status: number) {
  if (status === 401) return new GaError('auth')
  if (status === 403) return new GaError('permission')
  if (status === 429) return new GaError('quota')
  return new GaError('upstream')
}

/** Un seul runReport par rapport, plafonné et avec deux reprises bornées. */
async function runReport(propertyId: string, token: string, report: typeof GA4_REPORTS[number], from: string, until: string, signal: AbortSignal): Promise<GaReportData> {
  const body = {
    dimensions: report.dimensions.map((name) => ({ name })),
    metrics: report.metrics.map((name) => ({ name })),
    dateRanges: [{ startDate: from, endDate: until }], limit: 50, keepEmptyRows: false,
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method: 'POST', body: JSON.stringify(body), signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    }).catch(() => { throw new GaError('upstream') })
    if (response.ok) {
      const parsed = responseSchema.safeParse(await response.json().catch(() => null))
      if (!parsed.success) throw new GaError('invalid_response')
      return { key: report.key, dimensions: [...report.dimensions], metrics: [...report.metrics],
        totalRows: parsed.data.rowCount ?? parsed.data.rows.length,
        rows: parsed.data.rows.slice(0, 50).map((row) => ({
          dimensions: row.dimensionValues.map((value) => value.value.slice(0, 200)),
          metrics: row.metricValues.map((value) => Number(value.value)).map((value) => Number.isFinite(value) ? value : 0),
        })) }
    }
    await response.body?.cancel()
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt)); continue
    }
    throw classify(response.status)
  }
  throw new GaError('quota')
}

/** OAuth compte de service JWT -> access token. Aucune dépendance Google lourde. */
async function accessToken(email: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const claims = Buffer.from(JSON.stringify({
    iss: email, scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })).toString('base64url')
  const { createSign } = await import('node:crypto')
  const signer = createSign('RSA-SHA256'); signer.update(`${header}.${claims}`)
  const signature = signer.sign(privateKey, 'base64url')
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${signature}` }),
  }).catch(() => { throw new GaError('upstream') })
  if (!response.ok) throw classify(response.status)
  const payload = await response.json().catch(() => null) as { access_token?: string } | null
  if (!payload?.access_token) throw new GaError('auth')
  return payload.access_token
}

export type SyncResult = { configured: boolean; refreshed: number; stored: number; error: string | null }
/**
 * Cache idempotent, aucun appel GA4 à chaque ouverture du dashboard.
 * Deux exécutions serveur concurrentes écrivent la même clé sans doublon.
 * En qualification, aucune sortie réseau n'est effectuée.
 */
export async function syncGa4(from: string, until: string, env: NodeJS.ProcessEnv = process.env): Promise<SyncResult> {
  const config = readGaConfig(env)
  if (!config) return { configured: false, refreshed: 0, stored: 0, error: 'not_configured' }
  if (!ga4ExternalCallsAllowed(env)) return { configured: true, refreshed: 0, stored: 0, error: 'external_calls_disabled' }
  const ttl = Math.max(15, Math.min(120, Number(env.GA4_CACHE_MINUTES || 60)))
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000)
  let refreshed = 0
  try {
    const token = await accessToken(config.email, config.privateKey)
    for (const report of GA4_REPORTS) {
      try {
        const data = await runReport(config.propertyId, token, report, from, until, controller.signal)
        await storeAnalyticsReport({ key: report.key, from, until, status: 'ok', source: 'ga4', payload: data, ttlMinutes: ttl })
        refreshed += 1
      } catch (error) {
        const kind = error instanceof GaError ? error.kind : 'upstream'
        await storeAnalyticsReport({ key: report.key, from, until, status: kind === 'quota' ? 'quota' : 'error', source: 'ga4', payload: null, errorCode: kind, ttlMinutes: 15 })
      }
    }
    return { configured: true, refreshed, stored: refreshed, error: null }
  } catch (error) {
    return { configured: true, refreshed, stored: refreshed, error: error instanceof GaError ? error.kind : 'upstream' }
  } finally { clearTimeout(timer) }
}

export function statusFromSync(error: string | null): AnalyticsReportStatus {
  if (!error) return 'ok'
  if (error === 'not_configured' || error === 'external_calls_disabled') return 'unavailable'
  return error === 'quota' ? 'quota' : 'error'
}
