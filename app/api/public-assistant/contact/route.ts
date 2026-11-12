import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { publicKey } from '@/lib/marketing/assistant/provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.object({
  message: z.string().trim().min(10).max(1000),
  email: z.string().trim().max(254).optional(),
  preferredChannel: z.enum(['email', 'phone']).default('email'),
  locale: z.enum(['fr', 'ar', 'ary']).default('fr'),
}).strict()

export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin')
    const allowed = new Set([new URL(request.url).origin])
    for (const value of [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXT_PUBLIC_SITE_URL, process.env.APP_URL]) {
      if (!value) continue
      try { allowed.add(new URL(value).origin) } catch { /* valeur ignoree */ }
    }
    if (!origin || !allowed.has(origin)) return NextResponse.json({ error: 'Requête refusée.' }, { status: 403 })
    const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
    const limiter = publicKey(`contact:${ip}`)
    if (!limiter) return NextResponse.json({ error: 'Contact indisponible.' }, { status: 503 })
    const body = await request.json().catch(() => null)
    const parsed = schema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Demande invalide.' }, { status: 400 })
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('rpc_public_chat_contact', {
      p_message: parsed.data.message, p_email: parsed.data.email || null,
      p_channel: parsed.data.preferredChannel, p_locale: parsed.data.locale,
    })
    if (error) return NextResponse.json({ error: 'Contact indisponible.' }, { status: 503 })
    if (data?.error === 'rate_limit') return NextResponse.json({ error: 'Trop de demandes. Réessayez plus tard.' }, { status: 429 })
    if (data?.error) return NextResponse.json({ error: 'Demande invalide.' }, { status: 400 })
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Contact indisponible.' }, { status: 503 })
  }
}
