import { timingSafeEqual } from 'node:crypto'
import { acquisitionConfig, AcquisitionError, syncAcquisition } from '@/lib/acquisition/meta.server'

export const maxDuration = 55

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const received = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  if (!secret || received.length !== expected.length || !timingSafeEqual(expected, received)) return new Response(null, { status: 401 })
  const config = acquisitionConfig()
  if (!config) return new Response(null, { status: 503 })
  const headers = { 'Cache-Control': 'no-store' }
  try { return Response.json({ status: await syncAcquisition(config) }, { headers }) }
  catch (error) {
    const code = error instanceof AcquisitionError ? error.code : 'SYNC_FAILED'
    return Response.json({ error: code }, { status: code === 'RATE_LIMIT' ? 429 : 503, headers })
  }
}