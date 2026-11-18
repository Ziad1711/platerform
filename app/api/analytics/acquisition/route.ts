import { z } from 'zod'
import { paymentJson } from '@/lib/billing/payments.server'
import { metaConsentId, metaSameOrigin } from '@/lib/analytics/meta.server'
import { createAdminClient } from '@/lib/supabase/admin'
import { acquisitionTouch } from '@/lib/acquisition/touch'

export async function POST(request: Request) {
  if (!metaSameOrigin(request)) return new Response(null, { status: 403 })
  try {
    const consent = await metaConsentId()
    if (!consent) return new Response(null, { status: 204 })
    const params = z.record(z.string().max(250)).parse(await paymentJson(request))
    const touch = acquisitionTouch(new URLSearchParams(params))
    if (!touch) return new Response(null, { status: 204 })
    // Click identifiers already go through the existing consented Meta matching path.
    // Neither browser IDs nor fbclid are needed in the durable reporting dataset.
    const { error } = await createAdminClient().rpc('rpc_acquisition_touch', { p_consent: consent, p_touch: touch })
    return new Response(null, { status: error ? 503 : 204, headers: { 'Cache-Control': 'no-store' } })
  } catch { return new Response(null, { status: 400 }) }
}