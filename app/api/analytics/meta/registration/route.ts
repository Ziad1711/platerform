import { paymentJson } from '@/lib/billing/payments.server'
import { metaConsentId, metaId, metaSameOrigin } from '@/lib/analytics/meta.server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

export async function POST(request: Request) {
  if (!metaSameOrigin(request)) return new Response(null, { status: 403 })
  try {
    const consent = await metaConsentId()
    if (!consent) return new Response(null, { status: 404 })
    const { eventId, userId } = z.object({ eventId: metaId, userId: metaId }).strict().parse(await paymentJson(request))
    const { data, error } = await createAdminClient().rpc('rpc_meta_registration_event', {
      p_event: eventId, p_consent: consent, p_user: userId,
    })
    return new Response(null, { status: !error && data === true ? 204 : 404, headers: { 'Cache-Control': 'no-store' } })
  } catch { return new Response(null, { status: 400 }) }
}