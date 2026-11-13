import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildSystemPrompt, publicKnowledge, sanitizeReply } from '@/lib/marketing/assistant/knowledge'
import { clientIp, dailyBudgetMicro, publicAssistantEnabled, publicKey, publicProvider, visitorKey } from '@/lib/marketing/assistant/provider'
import { localAdmit, localAdmissionAvailable, localBudgetRemainingMicro, localRecordUsage, localRelease } from '@/lib/marketing/assistant/local-admission'
import { effectiveMaxOutputTokens, estimateMaxCostMicro } from '@/lib/marketing/assistant/openai-pricing'
import { linksFromReply } from '@/lib/marketing/assistant/public-routes'
import type { ProviderCallError } from '@/lib/assistant/providers/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Laisse le temps à une réponse Responses ; l'AbortController coupe à 20 s.
export const maxDuration = 30

const MAX_MESSAGE = 600
const MAX_ASSISTANT_MESSAGE = 1400
const MAX_HISTORY = 10
const MAX_HISTORY_CHARS = 9000
const MAX_BODY = 16384
const MAX_OUTPUT_TOKENS = 360

type AdminClient = ReturnType<typeof createAdminClient>

const requestSchema = z.object({
  locale: z.enum(['fr', 'ar', 'ary', 'en']).default('fr'),
  message: z.string().trim().min(1).max(MAX_MESSAGE),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(MAX_ASSISTANT_MESSAGE),
  })).max(MAX_HISTORY).default([]),
}).strict().superRefine((value, ctx) => {
  const total = value.history.reduce((sum, item) => sum + item.content.length, 0)
  if (total > MAX_HISTORY_CHARS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'history_too_large' })
  }
})

type SettleInput = {
  reservationId: string | null
  admittedLocally: boolean
  costMicro: number
  inputTokens: number
  outputTokens: number
  outcome: 'reply' | 'provider_error'
}

/**
 * Rapprochement best-effort : une panne de journal ne casse pas la réponse.
 * La réservation est libérée par `rpc_public_chat_settle` (idempotent) ; sans
 * réservation, la comptabilisation de secours reste appliquée.
 */
async function settleUsage(admin: AdminClient, input: SettleInput) {
  if (input.admittedLocally) return
  if (!input.reservationId) {
    try {
      const { error } = await admin.rpc('rpc_public_chat_record', {
        p_cost_micro: input.costMicro,
        p_input: input.inputTokens,
        p_output: input.outputTokens,
        p_outcome: input.outcome,
      })
      if (error) console.error('[public-assistant] usage_record_failed')
    } catch {
      console.error('[public-assistant] usage_record_failed')
    }
    return
  }
  try {
    const { error } = await admin.rpc('rpc_public_chat_settle', {
      p_reservation: input.reservationId,
      p_cost_micro: input.costMicro,
      p_input: input.inputTokens,
      p_output: input.outputTokens,
      p_outcome: input.outcome,
    })
    if (error) console.error('[public-assistant] usage_settle_failed')
  } catch {
    console.error('[public-assistant] usage_settle_failed')
  }
}

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })
}
function fail(error: string, status: number) {
  const messages: Record<string, string> = {
    origin: 'Requête refusée.', invalid: 'Message invalide.', rate: 'Trop de messages. Réessayez dans une minute.',
    budget: 'L’assistant est momentanément indisponible. Utilisez /pricing ou le contact.',
    unavailable: 'Le fournisseur IA est momentanément indisponible. Aucune réponse de remplacement n’a été générée.',
    too_large: 'Message trop long.',
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
    let remainingBudgetMicro: number | null = null
    if (admission.error && !localFallback) return fail('unavailable', 503)
    if (!localFallback) {
      const gate = (admission.data ?? {}) as { allowed?: boolean; code?: string; remaining_budget_micro?: number }
      if (!gate.allowed) return fail(gate.code === 'budget' ? 'budget' : 'rate', gate.code === 'budget' ? 503 : 429)
      if (typeof gate.remaining_budget_micro === 'number') remainingBudgetMicro = gate.remaining_budget_micro
    } else {
      const gate = localAdmit(`chat:${visitor.id}`)
      if (!gate.ok) return fail('rate', 429)
      admittedLocally = true
      remainingBudgetMicro = localBudgetRemainingMicro(dailyBudgetMicro())
    }

    let reservationId: string | null = null
    let estimatedCostMicro = 0

    try {
      const knowledge = await publicKnowledge()
      const choice = await publicProvider()
      if (choice.kind === 'unavailable') {
        console.error('[public-assistant] provider_unavailable', choice.reason)
        await settleUsage(admin, { reservationId: null, admittedLocally, costMicro: 0, inputTokens: 0, outputTokens: 0, outcome: 'provider_error' })
        return fail('unavailable', 503)
      }
      const systemPrompt = buildSystemPrompt(knowledge, parsed.data.locale)
      const messages = [...parsed.data.history, { role: 'user' as const, content: parsed.data.message }]
      const outputTokens = effectiveMaxOutputTokens(choice.model, MAX_OUTPUT_TOKENS)
      // Coût maximal réservé AVANT l'appel : sans réservation atomique, deux
      // requêtes simultanées peuvent lire le même budget restant et le dépasser.
      estimatedCostMicro = estimateMaxCostMicro(choice.model, systemPrompt, messages, outputTokens)
      if (admittedLocally) {
        if (remainingBudgetMicro !== null && remainingBudgetMicro < estimatedCostMicro) return fail('budget', 503)
      } else {
        const hold = await admin.rpc('rpc_public_chat_reserve', {
          p_key_hash: keyHash,
          p_amount_micro: estimatedCostMicro,
          p_daily_budget_micro: dailyBudgetMicro(),
        })
        // Refus par défaut : sans réservation démontrée, aucun appel payant.
        if (hold.error) return fail('unavailable', 503)
        const gate = (hold.data ?? {}) as { reserved?: boolean; code?: string; reservation_id?: string }
        if (gate.reserved !== true || typeof gate.reservation_id !== 'string') {
          return fail(gate.code === 'budget' ? 'budget' : 'unavailable', 503)
        }
        reservationId = gate.reservation_id
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 20_000)
      const result = await choice.provider.chat({
        model: choice.model,
        systemPrompt,
        messages,
        signal: controller.signal,
        maxOutputTokens: outputTokens,
      }).finally(() => clearTimeout(timer))
      // Un usage illisible n'est jamais compté zéro : le coût maximal réservé est retenu.
      const measuredMicro = Math.max(0, Math.round(result.providerCostUsd * 1_000_000))
      const costMicro = result.usageKnown === false ? Math.max(measuredMicro, estimatedCostMicro) : measuredMicro
      if (admittedLocally) localRecordUsage(costMicro, result.inputTokens, result.outputTokens)
      await settleUsage(admin, {
        reservationId, admittedLocally, costMicro,
        inputTokens: result.inputTokens, outputTokens: result.outputTokens, outcome: 'reply',
      })
      reservationId = null
      const response = json({
        reply: sanitizeReply(result.text),
        locale: parsed.data.locale,
        provider: choice.kind,
        live: choice.kind === 'openai',
        links: linksFromReply(result.text),
      })
      if (visitor.setCookie) {
        response.cookies.set('jisra-ai-visitor', visitor.id, { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 30 })
      }
      return response
    } catch (error) {
      // Un échec fournisseur peut avoir consommé des tokens : cet usage est conservé.
      const usage = (error as ProviderCallError | undefined)?.usage
      const measuredMicro = usage ? Math.max(0, Math.round(usage.providerCostUsd * 1_000_000)) : 0
      const costMicro = usage && usage.usageKnown === false
        ? Math.max(measuredMicro, estimatedCostMicro)
        : measuredMicro
      if (admittedLocally) {
        localRecordUsage(costMicro, usage?.inputTokens ?? 0, usage?.outputTokens ?? 0)
      }
      console.error('[public-assistant] provider_error', error instanceof Error ? error.message : 'unknown')
      await settleUsage(admin, {
        reservationId, admittedLocally, costMicro,
        inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0, outcome: 'provider_error',
      })
      return fail('unavailable', 503)
    } finally {
      if (admittedLocally) localRelease(`chat:${visitor.id}`)
      else {
        try {
          await admin.rpc('rpc_public_chat_release', { p_key_hash: keyHash })
        } catch {
          console.error('[public-assistant] release_failed')
        }
      }
    }
  } catch {
    return fail('unavailable', 503)
  }
}
