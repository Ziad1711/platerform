import { z } from 'zod'
import { paymentJson } from '@/lib/billing/payments.server'
import { metaPage, metaViewContent } from '@/lib/analytics/meta-config'
import { metaBrowserMatch, metaConsentId, metaId, metaSameOrigin } from '@/lib/analytics/meta.server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  if (!metaSameOrigin(request)) return new Response(null, { status: 403 })
  try {
    const consent = await metaConsentId()
    if (!consent) return new Response(null, { status: 204 })
    const { path, pageId, contentId } = z.object({ path: z.string().max(120), pageId: metaId, contentId: metaId.optional() }).strict().parse(await paymentJson(request))
    const clean = metaPage(path)
    if (!clean || pageId === contentId || Boolean(contentId) !== metaViewContent(clean)) return new Response(null, { status: 400 })
    const { data, error } = await createAdminClient().rpc('rpc_meta_page', {
      p_consent: consent, p_page: pageId, p_content: contentId ?? null,
      p_path: clean, p_matching: await metaBrowserMatch(request),
    })
    return new Response(null, { status: error ? 503 : data === true ? 200 : 204, headers: { 'Cache-Control': 'no-store' } })
  } catch { return new Response(null, { status: 400 }) }
}