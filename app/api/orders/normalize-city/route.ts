import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import { normalizeCityName } from '@/lib/integrations/city-normalizer'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  let rawCity = ''
  try {
    await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as { city?: string; orderId?: string }
    const city = String(body.city || '').trim()
    rawCity = city
    const orderId = String(body.orderId || '').trim() || null

    console.log('[api/orders/normalize-city] request', { city, orderId })

    if (!city) {
      return NextResponse.json({ error: 'CITY_REQUIRED' }, { status: 400 })
    }

    const result = await normalizeCityName({
      rawCity: city,
      orderId,
      supabase: createAdminClient(),
    })

    console.log('[api/orders/normalize-city] result', result)

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CITY_NORMALIZATION_FAILED'
    console.error('[api/orders/normalize-city] fallback:', message)
    return NextResponse.json({
      ok: true,
      cityName: rawCity,
      cityKey: null,
      source: 'ai_failed',
      learned: false,
      fallback: true,
    })
  }
}
