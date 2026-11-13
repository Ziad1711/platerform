import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { clientIp, publicAssistantEnabled, publicKey, visitorKey } from '@/lib/marketing/assistant/provider'
import { localAdmit, localAdmissionAvailable, localRelease } from '@/lib/marketing/assistant/local-admission'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY = 4096

const schema = z.object({
  message: z.string().trim().min(10).max(1000),
  email: z.string().trim().max(254).optional(),
  preferredChannel: z.enum(['email', 'phone']).default('email'),
  locale: z.enum(['fr', 'ar', 'ary']).default('fr'),
}).strict()

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })
}

/** Lecture bornée réelle, y compris si Content-Length est absent ou falsifié. */
async function readBody(request: Request) {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) throw new Error('too_large')
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('invalid')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('invalid')
  let size = 0
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY) { await reader.cancel(); throw new Error('too_large') }
    chunks.push(value)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new Error('invalid')
  }
}

export async function POST(request: Request) {
  // Fermé par défaut : la route reste inaccessible tant que l'activation
  // publique n'est pas explicitement autorisée (hors Production pour les tests).
  if (!publicAssistantEnabled()) return json({ error: 'Contact indisponible.' }, 503)
  try {
    const origin = request.headers.get('origin')
    const allowed = new Set([new URL(request.url).origin])
    for (const value of [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXT_PUBLIC_SITE_URL, process.env.APP_URL]) {
      if (!value) continue
      try { allowed.add(new URL(value).origin) } catch { /* valeur ignoree */ }
    }
    if (!origin || !allowed.has(origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
      return json({ error: 'Requête refusée.' }, 403)
    }

    let body: unknown
    try {
      body = await readBody(request)
    } catch (error) {
      return error instanceof Error && error.message === 'too_large'
        ? json({ error: 'Demande trop volumineuse.' }, 413)
        : json({ error: 'Demande invalide.' }, 400)
    }
    const parsed = schema.safeParse(body)
    if (!parsed.success) return json({ error: 'Demande invalide.' }, 400)

    const admin = createAdminClient()
    const visitor = visitorKey(request)
    const keyHash = publicKey(`contact:${visitor.id}`)
    const ipHash = publicKey(`contact-ip:${clientIp(request)}`)
    const globalHash = publicKey('contact:global')
    if (!keyHash || !ipHash || !globalHash) return json({ error: 'Contact indisponible.' }, 503)

    const admission = await admin.rpc('rpc_public_contact_admit', {
      p_key_hash: keyHash, p_ip_hash: ipHash, p_global_hash: globalHash,
    })
    // Base non migree (developpement local) : admission en memoire, jamais en Production.
    const localFallback = Boolean(admission.error) && localAdmissionAvailable()
    if (admission.error && !localFallback) return json({ error: 'Contact indisponible.' }, 503)
    let localKey: string | null = null
    if (!localFallback) {
      const gate = (admission.data ?? {}) as { allowed?: boolean; code?: string }
      if (!gate.allowed) {
        return gate.code === 'rate_limit'
          ? json({ error: 'Trop de demandes. Réessayez plus tard.' }, 429)
          : json({ error: 'Contact indisponible.' }, 503)
      }
    } else {
      // Repli local (developpement) : la cle d'admission reste l'adresse, pour
      // qu'un client sans cookie ne contourne pas la limite.
      localKey = `contact-ip:${clientIp(request)}`
      const gate = localAdmit(localKey, 5)
      if (!gate.ok) return json({ error: 'Trop de demandes. Réessayez plus tard.' }, 429)
    }

    try {
      const { data, error } = await admin.rpc('rpc_public_chat_contact', {
        p_message: parsed.data.message, p_email: parsed.data.email || null,
        p_channel: parsed.data.preferredChannel, p_locale: parsed.data.locale,
      })
      if (error) return json({ error: 'Contact indisponible.' }, 503)
      if (data?.error === 'rate_limit') return json({ error: 'Trop de demandes. Réessayez plus tard.' }, 429)
      if (data?.error) return json({ error: 'Demande invalide.' }, 400)
      const response = json({ ok: true })
      if (visitor.setCookie) {
        response.cookies.set('jisra-ai-visitor', visitor.id, { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 30 })
      }
      return response
    } finally {
      if (localKey) localRelease(localKey)
    }
  } catch {
    return json({ error: 'Contact indisponible.' }, 503)
  }
}
