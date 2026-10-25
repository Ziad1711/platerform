import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import { normalizeCityName } from '@/lib/integrations/city-normalizer'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Transporteurs dont Confirmation peut prévisualiser la ville sans écriture.
 * Les autres transporteurs conservent une sélection strictement manuelle.
 */
const PREVIEW_PROVIDER_SLUGS = new Set(['rapid-delivery', 'maroc-go-delivery', 'rushliv'])

export async function POST(request: Request) {
  let rawCity = ''
  try {
    const { user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      city?: string
      orderId?: string
      providerSlug?: string
      preview?: boolean
    }
    const city = String(body.city || '').trim()
    rawCity = city
    const orderId = String(body.orderId || '').trim() || null
    let providerSlug = String(body.providerSlug || '').trim() || 'rapid-delivery'
    // Aperçu : résolution en lecture seule, sans écriture sur la commande ni sur
    // les alias. Le moteur et ses règles restent identiques.
    const preview = body.preview === true

    console.log('[api/orders/normalize-city] request', { city, orderId, providerSlug, preview })

    if (!city) {
      return NextResponse.json({ error: 'CITY_REQUIRED' }, { status: 400 })
    }

    if (preview) {
      const requestedSlug = String(body.providerSlug || '').trim()
      if (!PREVIEW_PROVIDER_SLUGS.has(requestedSlug)) {
        return NextResponse.json({ error: 'CITY_PREVIEW_PROVIDER_NOT_ALLOWED' }, { status: 400 })
      }
      providerSlug = requestedSlug
    }

    // Un orderId cible la commande d'un store précis : on vérifie que
    // l'appelant en est encore un membre actif avant toute lecture/écriture
    // par le client service-role, et on en déduit le provider au besoin.
    if (orderId) {
      const admin = createAdminClient()
      const { data: order } = await admin
        .from('orders')
        .select('store_id, delivery_company_id')
        .eq('id', orderId)
        .maybeSingle()

      if (!order) return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })

      const { data: membership } = await admin
        .from('store_members')
        .select('store_id')
        .eq('user_id', user.id)
        .eq('store_id', order.store_id)
        .eq('status', 'active')
        .maybeSingle()

      if (!membership) return NextResponse.json({ error: 'STORE_ACCESS_DENIED' }, { status: 403 })

      if (!body.providerSlug && order.delivery_company_id) {
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
      preview,
    })

    console.log('[api/orders/normalize-city] result', { ...result, preview })

    return NextResponse.json({ ok: true, ...result, preview })
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
