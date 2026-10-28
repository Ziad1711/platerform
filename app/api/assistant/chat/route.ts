import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  addMessage,
  createThread,
  findAssistantReplyByRequestId,
  getThread,
  listMessages,
  touchThread,
} from '@/lib/assistant/chat'
import {
  chargeCredits,
  computeCreditsUsed,
  ensureCreditsAvailable,
  estimateCreditsForRequest,
  toWalletSnapshot,
} from '@/lib/assistant/credits'
import { asksForOtherStore, resolveIntent, resolveRangeFromQuestion, createEmptyMemory, updateMemoryFromAnalysis, type ThreadAnalyticMemory } from '@/lib/assistant/intents'
import { getAssistantModelName } from '@/lib/assistant/providers'
import { buildGreetingResponse, buildSmallTalkResponse, buildStructuredResponseFromContext } from '@/lib/assistant/response'
import {
  assertTrustedOrigin,
  requireAssistantStoreAccess,
  requireAuthenticatedUser,
  toPublicError,
  withTimeout,
} from '@/lib/assistant/security'
import { acquireAssistantSlot, releaseAssistantSlot } from '@/lib/assistant/rate-limit'
import type { AssistantStructuredResponse } from '@/lib/assistant/types'
import { runSecureAssistantAgent } from '@/lib/assistant/agent'

/** Longueur maximale d'un message utilisateur (caractères). */
const MAX_MESSAGE_LENGTH = 2000
/** Budget d'une analyse complète (lecture des outils + appel IA). */
const ASSISTANT_REQUEST_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.ASSISTANT_REQUEST_TIMEOUT_MS || 45_000)
)
/** Nombre de messages d'historique transmis au modèle. */
const CONVERSATION_HISTORY_LIMIT = 8
/** Fenêtre d'historique relue pour la mémoire analytique et le contexte. */
const MESSAGE_CONTEXT_WINDOW = 50

const ChatRequestSchema = z.object({
  storeId: z.string().uuid().nullish(),
  threadId: z.string().uuid().nullish(),
  requestId: z.string().uuid().nullish(),
  message: z.string().min(1).max(MAX_MESSAGE_LENGTH),
})

type ChatRequestInput = z.infer<typeof ChatRequestSchema>

/** Validation stricte du corps : aucune valeur non typée n'atteint le moteur. */
function readChatRequest(raw: unknown): ChatRequestInput {
  if (!raw || typeof raw !== 'object') throw new Error('INVALID_REQUEST')

  const source = raw as Record<string, unknown>
  const normalizeId = (value: unknown) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }

  const rawMessage = typeof source.message === 'string' ? source.message.trim() : ''
  if (!rawMessage) throw new Error('EMPTY_MESSAGE')
  if (rawMessage.length > MAX_MESSAGE_LENGTH) throw new Error('MESSAGE_TOO_LONG')

  const parsed = ChatRequestSchema.safeParse({
    storeId: normalizeId(source.storeId),
    threadId: normalizeId(source.threadId),
    requestId: normalizeId(source.requestId),
    message: rawMessage,
  })

  if (!parsed.success) throw new Error('INVALID_REQUEST')
  return parsed.data
}

/** Erreurs du moteur remappées vers des codes contrôlés (aucun détail interne). */
function toControlledAgentError(error: unknown): Error {
  const code = error instanceof Error ? error.message : ''
  if (code === 'ASSISTANT_TIMEOUT') return new Error(code)
  if (/OPENAI|DEEPSEEK|PROVIDER/i.test(code)) return new Error('ASSISTANT_PROVIDER_FAILED')
  return new Error('ASSISTANT_ERROR')
}

function buildAutoThreadTitle(userMessage: string, assistantMessage: string) {
  const source = userMessage.trim() || assistantMessage.trim()
  const normalized = source
    .replace(/[\n\r]+/g, ' ')
    .replace(/[.,!?;:()[\]{}"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) return 'Nouvelle conversation'

  const words = normalized.split(' ').filter(Boolean)
  const title = words.slice(0, 7).join(' ')
  return title.length > 60 ? `${title.slice(0, 57)}...` : title
}

function resolveAiThreadTitle(raw?: string | null) {
  const clean = String(raw || '')
    .replace(/[\n\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!clean) return undefined
  if (clean.length < 4) return undefined
  if (clean.toLowerCase() === 'nouvelle conversation') return undefined
  return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean
}

export async function POST(request: Request) {
  const startedAt = Date.now()
  let slotKey: string | null = null

  try {
    assertTrustedOrigin(request)

    const { supabase, user } = await requireAuthenticatedUser()

    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      throw new Error('INVALID_REQUEST')
    }
    const body = readChatRequest(rawBody)

    const slot = acquireAssistantSlot(user.id)
    if (!slot.ok) throw new Error(slot.code)
    slotKey = user.id

    // Périmètre explicite : une seule boutique par requête, jamais d'agrégation
    // implicite de plusieurs boutiques (devises et tenants différents).
    const scope = await requireAssistantStoreAccess(supabase, user.id, body.storeId)
    const selectedStoreId = scope.storeId
    const targetStoreIds = [selectedStoreId]

    const [{ data: storeMeta, error: storeMetaError }, { data: profileMeta }] = await Promise.all([
      supabase
        .from('stores')
        .select('id, name, currency')
        .eq('id', selectedStoreId)
        .maybeSingle(),
      supabase
        .from('profiles')
        .select('preferred_currency')
        .eq('id', user.id)
        .maybeSingle(),
    ])

    if (storeMetaError || !storeMeta) {
      throw new Error('STORE_ACCESS_CHECK_FAILED')
    }

    const resolvedStoreCurrency = String(storeMeta.currency || 'MAD')
    const preferredCurrency = (profileMeta as { preferred_currency?: string | null } | null)?.preferred_currency
    const userMainCurrency = String(preferredCurrency || resolvedStoreCurrency)

    // Toute conversation est désormais liée à la boutique analysée.
    let threadId = body.threadId || null
    if (!threadId) {
      const created = await createThread(supabase, user.id, selectedStoreId, body.message.slice(0, 60))
      threadId = created.id
    } else {
      await getThread(supabase, threadId, user.id, selectedStoreId)
    }

    if (!threadId) {
      throw new Error('THREAD_CREATE_FAILED')
    }

    const ensuredThreadId = threadId

    // Rejeu idempotent : une même requête ne produit ni second appel IA ni
    // second débit, après un double clic ou un retry réseau. Une conversation
    // créée à l'instant ne peut pas contenir de requête déjà traitée.
    if (body.requestId && body.threadId) {
      const replayed = await findAssistantReplyByRequestId(supabase, ensuredThreadId, body.requestId)
      if (replayed) {
        const replayMetadata = (replayed.metadata || null) as Record<string, unknown> | null
        return NextResponse.json({
          threadId: ensuredThreadId,
          assistantMessage: replayed,
          structured_response: replayMetadata?.structured_response,
          replayed: true,
          credit_status: 'not_charged',
          usage: {
            creditsUsed: 0,
            inputTokens: 0,
            outputTokens: 0,
            providerName: 'replay',
            modelName: 'replay',
            providerCostUsd: 0,
          },
        })
      }
    }

    const previousMessages = await listMessages(supabase, ensuredThreadId, {
      limit: MESSAGE_CONTEXT_WINDOW,
    })
    const isFirstExchange = previousMessages.length === 0

    const conversationalHistory = previousMessages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-CONVERSATION_HISTORY_LIMIT)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content || '') }))

    // Mémoire analytique : restaurée depuis le dernier message assistant.
    const lastAssistantMsg = [...previousMessages].reverse().find((m) => m.role === 'assistant')
    const threadMeta = (lastAssistantMsg?.metadata || null) as Record<string, unknown> | null
    const threadMemory: ThreadAnalyticMemory = threadMeta?.analytic_memory
      ? (threadMeta.analytic_memory as ThreadAnalyticMemory)
      : createEmptyMemory()

    const intent = resolveIntent(body.message)
    const range = resolveRangeFromQuestion(body.message, threadMemory)

    // Réponses conversationnelles et refus multi-tenant : aucun appel IA, aucun
    // débit, mais message tracé avec la clé d'idempotence.
    let smallResponse: AssistantStructuredResponse | null = null

    if (asksForOtherStore(body.message)) {
      smallResponse = {
        message_text:
          'Je ne peux pas accéder à un autre store. Je peux seulement analyser le store actif auquel vous avez accès.',
        suggestions: ['Analyse mon business', 'Montre-moi mes ventes', 'Analyse mon stock'],
        activity_steps: [{ label: 'Vérification des accès' }, { label: 'Refus multi-tenant sécurisé' }],
        chart: false,
      }
    } else if (intent === 'greeting' || intent === 'small_talk') {
      smallResponse = intent === 'greeting' ? buildGreetingResponse() : buildSmallTalkResponse()
      smallResponse.activity_steps = [{ label: 'Interaction conversationnelle' }]
    }

    if (smallResponse) {
      await addMessage(
        supabase,
        ensuredThreadId,
        'user',
        body.message,
        0,
        body.requestId ? { request_id: body.requestId } : null
      )
      const assistantMessage = await addMessage(
        supabase,
        ensuredThreadId,
        'assistant',
        smallResponse.message_text,
        0,
        { structured_response: smallResponse }
      )
      const nextTitle = isFirstExchange ? resolveAiThreadTitle(smallResponse.conversation_title) : undefined
      await touchThread(supabase, ensuredThreadId, nextTitle)

      return NextResponse.json({
        threadId: ensuredThreadId,
        assistantMessage,
        structured_response: smallResponse,
        credit_status: 'not_charged',
        usage: {
          creditsUsed: 0,
          inputTokens: 0,
          outputTokens: 0,
          providerName: 'none',
          modelName: 'none',
          providerCostUsd: 0,
        },
      })
    }

    const estimatedCredits = estimateCreditsForRequest({
      message: body.message,
      history: conversationalHistory.map((m) => m.content),
      // Réserve pour le prompt système et les résultats d'outils, absents du
      // calcul d'origine : la pré-réservation reste prudente, jamais exacte.
      reserveInputTokens: 1500,
    })

    const { wallet } = await ensureCreditsAvailable(supabase, estimatedCredits)

    const model = getAssistantModelName()

    let agentResult: Awaited<ReturnType<typeof runSecureAssistantAgent>>
    try {
      agentResult = await withTimeout(
        runSecureAssistantAgent({
          supabase,
          scopeStoreIds: targetStoreIds,
          scopeContext: {
            scopeStoreIds: targetStoreIds,
            displayStoreId: selectedStoreId,
            displayStoreName: String(storeMeta.name || 'Store'),
            displayCurrency: resolvedStoreCurrency,
            userMainCurrency,
          },
          intent,
          range,
          userMessage: body.message,
          conversationHistory: conversationalHistory,
          providerModel: model,
        }),
        ASSISTANT_REQUEST_TIMEOUT_MS
      )
    } catch (agentError) {
      const controlled = toControlledAgentError(agentError)
      if (controlled.message !== 'ASSISTANT_TIMEOUT') {
        console.error('[assistant] agent_failed', {
          code: controlled.message,
          storeId: selectedStoreId,
          durationMs: Date.now() - startedAt,
        })
      }
      throw controlled
    }

    const providerResult = agentResult.providerUsage

    const creditsUsed = computeCreditsUsed(providerResult.inputTokens, providerResult.outputTokens)
    const walletSnapshot = toWalletSnapshot(wallet)
    if (walletSnapshot.remainingCredits < creditsUsed) {
      throw new Error('INSUFFICIENT_CREDITS')
    }

    const structuredResponse = agentResult.structuredResponse || buildStructuredResponseFromContext(intent, providerResult.text, {})

    // Mettre à jour la mémoire analytique et la persister dans les métadonnées
    const updatedMemory = updateMemoryFromAnalysis(threadMemory, body.message, range, intent)

    await addMessage(
      supabase,
      ensuredThreadId,
      'user',
      body.message,
      0,
      body.requestId ? { request_id: body.requestId } : null
    )
    const assistantMessage = await addMessage(
      supabase,
      ensuredThreadId,
      'assistant',
      structuredResponse.message_text,
      creditsUsed,
      {
        structured_response: structuredResponse,
        analytic_memory: updatedMemory,
      }
    )
    const nextTitle = isFirstExchange
      ? resolveAiThreadTitle(structuredResponse.conversation_title) || buildAutoThreadTitle(body.message, structuredResponse.message_text)
      : undefined
    await touchThread(supabase, ensuredThreadId, nextTitle)

    let warning: string | null = null

    const { error: usageError } = await supabase.from('ai_usage').insert({
      user_id: user.id,
      store_id: selectedStoreId,
      thread_id: ensuredThreadId,
      feature: 'chatbot',
      credits_used: creditsUsed,
      input_tokens: providerResult.inputTokens,
      output_tokens: providerResult.outputTokens,
      provider_name: providerResult.providerName,
      model_name: providerResult.modelName,
      provider_cost_usd: providerResult.providerCostUsd,
    })

    if (usageError) {
      warning = 'Le journal d’usage IA n’a pas pu être enregistré.'
      console.error('[assistant] usage_log_failed', { code: usageError.code || 'unknown' })
    }

    // Débit après persistance : une erreur de facturation ne crée jamais de
    // message fantôme, et le statut réel est exposé au client.
    const charge = await chargeCredits(supabase, creditsUsed)
    if (charge.status !== 'charged') {
      warning = warning || 'La consommation de crédits n’a pas pu être confirmée.'
      console.error('[assistant] credit_charge_failed', { status: charge.status })
    }

    const chargedCredits = charge.status === 'charged' ? creditsUsed : 0

    console.info('[assistant] request_done', {
      intent,
      storeId: selectedStoreId,
      durationMs: Date.now() - startedAt,
      creditsUsed,
      charge: charge.status,
      provider: providerResult.providerName,
      model: providerResult.modelName,
    })

    return NextResponse.json({
      threadId: ensuredThreadId,
      assistantMessage,
      usage: {
        creditsUsed,
        inputTokens: providerResult.inputTokens,
        outputTokens: providerResult.outputTokens,
        providerName: providerResult.providerName,
        modelName: providerResult.modelName,
        providerCostUsd: providerResult.providerCostUsd,
      },
      structured_response: structuredResponse,
      warning,
      credit_status: charge.status,
      wallet: {
        monthlyCredits: walletSnapshot.monthlyCredits,
        creditsUsed: walletSnapshot.creditsUsed + chargedCredits,
        remainingCredits: Math.max(0, walletSnapshot.remainingCredits - chargedCredits),
      },
    })
  } catch (error) {
    const publicError = toPublicError(error)
    if (publicError.status >= 500) {
      console.error('[assistant] request_failed', { code: publicError.code })
    }

    return NextResponse.json(
      { error: publicError.code, code: publicError.code, message: publicError.message },
      { status: publicError.status }
    )
  } finally {
    if (slotKey) releaseAssistantSlot(slotKey)
  }
}
