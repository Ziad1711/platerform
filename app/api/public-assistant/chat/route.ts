import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildSystemPrompt, publicKnowledge, sanitizeReply } from '@/lib/marketing/assistant/knowledge'
import { clientIp, dailyBudgetMicro, publicAssistantEnabled, publicKey, publicProvider, visitorKey } from '@/lib/marketing/assistant/provider'
import { localAdmit, localAdmissionAvailable, localRelease } from '@/lib/marketing/assistant/local-admission'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_MESSAGE = 600
const MAX_HISTORY = 6
const MAX_BODY = 8192
const requestSchema = z.object({
  locale: z.enum(['fr', 'ar', 'ary']).default('fr'),
  message: z.string().trim().min(1).max(MAX_MESSAGE),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(MAX_MESSAGE) })).max(MAX_HISTORY).default([]),
}).strict()

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })
}
function fail(error: string, status: number) {
  const messages: Record<string, string> = {
    origin: 'Requête refusée.', invalid: 'Message invalide.', rate: 'Trop de messages. Réessayez dans une minute.',
    budget: 'L’assistant est momentanément indisponible. Utilisez /pricing ou le contact.',
    unavailable: 'Assistant momentanément indisponible.', too_large: 'Message trop long.',
  }
  return json({ error: messages[error] || messages.unavailable }, status)
}

export async function POST(request: Request) {
  try {
    // Fermé par défaut : aucune réponse scriptée servie à de vrais visiteurs.
    if (!publicAssistantEnabled()) return fail('unavailable', 503)
    const requestOrigin = new URL(request.url).origin
    const origin = request.headers.get('origin')
    const allowed = new Set([requestOrigin])
    for (const value of [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXT_PUBLIC_SITE_URL, process.env.APP_URL]) {
      if (!value) continue
      try { allowed.add(new URL(value).origin) } catch { /* valeur ignoree */ }
    }
    if (!origin || !allowed.has(origin) || request.headers.get('sec-fetch-site') === 'cross-site') return fail('origin', 403)
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return fail('too_large', 413)
    if (!request.headers.get('content-type')?.startsWith('application/json')) return fail('invalid', 400)
    const reader = request.body?.getReader()
    if (!reader) return fail('invalid', 400)
    let size = 0; const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY) { await reader.cancel(); return fail('too_large', 413) }
      chunks.push(value)
    }
    const parsed = requestSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    if (!parsed.success) return fail('invalid', 400)

    const admin = createAdminClient()
    const visitor = visitorKey(request)
    const keyHash = publicKey(visitor.id)
    const ipHash = publicKey(`ip:${clientIp(request)}`)
    if (!keyHash || !ipHash) return fail('unavailable', 503)

    const admission = await admin.rpc('rpc_public_chat_admit', {
      p_key_hash: keyHash, p_ip_hash: ipHash, p_daily_budget_micro: dailyBudgetMicro(),
    })
    // Base non migree (developpement local) : admission en memoire, jamais en Production.
    const localFallback = admission.error && localAdmissionAvailable()
    let admittedLocally = false
    if (admission.error && !localFallback) return fail('unavailable', 503)
    if (!localFallback) {
      const gate = admission.data as { allowed?: boolean; code?: string }
      if (!gate.allowed) return fail(gate.code === 'budget' ? 'budget' : 'rate', gate.code === 'budget' ? 503 : 429)
    } else {
      const gate = localAdmit(`chat:${visitor.id}`)
      if (!gate.ok) return fail('rate', 429)
      admittedLocally = true
    }

    try {
      const knowledge = await publicKnowledge()
      const choice = await publicProvider()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 20_000)
      let result
      try {
        result = await choice.provider.chat({
          model: choice.model, systemPrompt: buildSystemPrompt(knowledge, parsed.data.locale),
          messages: [...parsed.data.history, { role: 'user' as const, content: parsed.data.message }],
          signal: controller.signal, maxOutputTokens: 320,
        })
      } finally { clearTimeout(timer) }
      const costMicro = Math.max(0, Math.round(result.providerCostUsd * 1_000_000))
      if (!admittedLocally) {
        await admin.rpc('rpc_public_chat_record', {
          p_cost_micro: costMicro, p_input: result.inputTokens, p_output: result.outputTokens, p_outcome: 'reply',
        })
      }
      const response = json({ reply: sanitizeReply(result.text), locale: parsed.data.locale,
        links: [{ href: '/pricing', label: 'Voir les forfaits' }, { href: '/signup', label: 'Créer un compte' }, { href: '/subscribe', label: 'Récapitulatif /subscribe' }],
        live: choice.live })
      if (visitor.setCookie) {
        response.cookies.set('jisra-ai-visitor', visitor.id, { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 30 })
      }
      return response
    } catch {
      if (!admittedLocally) {
        await admin.rpc('rpc_public_chat_record', { p_cost_micro: 0, p_input: 0, p_output: 0, p_outcome: 'provider_error' })
      }
      return fail('unavailable', 503)
    } finally {
      if (admittedLocally) localRelease(`chat:${visitor.id}`)
      else await admin.rpc('rpc_public_chat_release', { p_key_hash: keyHash })
    }
  } catch {
    return fail('unavailable', 503)
  }
}
