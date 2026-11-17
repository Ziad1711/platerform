import { NextResponse } from 'next/server'
import { drainEmailOutbox } from '@/lib/email/notify.server'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET || ''
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }
  try {
    const result = await drainEmailOutbox()
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'EMAIL_DRAIN_FAILED' }, { status: 500 })
  }
}
