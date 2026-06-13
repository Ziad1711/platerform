import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import { normalizeCityName } from '@/lib/integrations/city-normalizer'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  let rawCity = ''
  try {
    await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as { city?: string; orderId?: string; providerSlug?: string }
    const city = String(body.city || '').trim()
    rawCity = city
    const orderId = String(body.orderId || '').trim() || null
    let providerSlug = String(body.providerSlug || '').trim() || 'rapid-delivery'

    console.log('[api/orders/normalize-city] request', { city, orderId, providerSlug })

    if (!city) {
      return NextResponse.json({ error: 'CITY_REQUIRED' }, { status: 400 })
    }

    // Si un orderId est fourni sans providerSlug explicite, on déduit le provider
    // depuis la delivery_company de la commande
    if (orderId && !body.providerSlug) {
      const admin = createAdminClient()
      const { data: order } = await admin
        .from('orders')
        .select('delivery_company_id')
        .eq('id', orderId)
        .maybeSingle()

      if (order?.delivery_company_id) {
        const { data: company } = await admin
          .from('delivery_companies')
          .select('api_provider')
          .eq('id', order.delivery_company_id)
          .maybeSingle()

        if (company?.api_provider) {
          providerSlug = company.api_provider
        }
      }
    }

    const result = await normalizeCityName({
      rawCity: city,
      orderId,
      supabase: createAdminClient(),
      providerSlug,
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
