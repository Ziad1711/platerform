import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { drainWebhookInbox } from '@/lib/integrations/webhook-inbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_NOT_CONFIGURED' }, { status: 503 })
  const expected = Buffer.from('Bearer ' + secret)
  const provided = Buffer.from(request.headers.get('authorization') || '')
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }
  try { return NextResponse.json(await drainWebhookInbox()) }
  catch { return NextResponse.json({ error: 'WEBHOOK_RECOVERY_FAILED' }, { status: 500 }) }
}