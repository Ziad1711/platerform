import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { paymentJson } from '@/lib/billing/payments.server'
import { META_CONSENT_COOKIE } from '@/lib/analytics/meta-config'
import { metaBrowserMatch, metaConsentId, metaRuntimeEnabled, metaSameOrigin } from '@/lib/analytics/meta.server'
import { getServerUserResult, hasSessionCookie } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

export async function POST(request: Request) {
  if (!metaRuntimeEnabled()) return new Response(null, { status: 503 })
  if (!metaSameOrigin(request)) return new Response(null, { status: 403 })
  try {
    const { granted } = z.object({ granted: z.boolean() }).strict().parse(await paymentJson(request))
    const old = await metaConsentId()
    const auth = await hasSessionCookie() ? await getServerUserResult() : null
    if (auth?.authUnavailable && (granted || !old)) return new Response(null, { status: 503 })
    const id = granted ? randomUUID() : null
    const { error } = await createAdminClient().rpc('rpc_meta_consent', {
      p_old: old, p_new: id, p_user: auth?.user?.id ?? null,
      p_matching: granted ? await metaBrowserMatch(request) : {},
    })
    if (error) return new Response(null, { status: 503 })
    const response = new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
    response.cookies.set(META_CONSENT_COOKIE, id ?? 'denied', {
      sameSite: 'lax', secure: new URL(request.url).protocol === 'https:', path: '/', maxAge: 180 * 86400,
    })
    return response
  } catch { return new Response(null, { status: 400 }) }
}