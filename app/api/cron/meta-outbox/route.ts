import { NextResponse } from 'next/server'
import { drainMetaOutbox } from '@/lib/analytics/meta.server'

export const runtime = 'nodejs'
export const maxDuration = 25

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response(null, { status: 401 })
  }
  try {
    return NextResponse.json(await drainMetaOutbox(), { headers: { 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ error: 'META_DRAIN_FAILED' }, { status: 503 }) }
}