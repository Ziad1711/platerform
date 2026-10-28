import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  addMessage,
  createThread,
  findAssistantReplyByRequestId,
  getMessageById,
  getThread,
  listMessages,
  touchThread,
} from '@/lib/assistant/chat'
import {
  computeCreditsUsed,
  ensureCreditsAvailable,
  estimateCreditsForRequest,
  releaseCreditReservation,
  reserveCreditsForRequest,
  toWalletSnapshot,
} from '@/lib/assistant/credits'
import { beginAssistantRequest, canonicalRequestPayload, computeRequestFingerprint } from '@/lib/assistant/idempotency'
import { finalizeAssistantTurn } from '@/lib/assistant/finalization'
import { asksForOtherStore, extractComparisonRanges, resolveIntent, resolveRangeFromQuestion, createEmptyMemory, updateMemoryFromAnalysis, type ThreadAnalyticMemory } from '@/lib/assistant/intents'
import { resolveAssistantBusinessRange } from '@/lib/assistant/analytics-reader'
import { getAssistantModelName } from '@/lib/assistant/providers'
import { buildGreetingResponse, buildSmallTalkResponse, buildStructuredResponseFromContext } from '@/lib/assistant/response'
import {
  assertTrustedOrigin,
  requireAssistantStoreAccess,
  requireAuthenticatedUser,
  toPublicError,
} from '@/lib/assistant/security'
import { acquireAssistantSlot, releaseAssistantSlot } from '@/lib/assistant/rate-limit'
import type { AssistantStructuredResponse } from '@/lib/assistant/types'
import { runSecureAssistantAgent } from '@/lib/assistant/agent'

/** Longueur maximale d'un message utilisateur (caractères). */
const MAX_MESSAGE_LENGTH = 2000
/** Taille maximale du corps JSON accepté (octets). */
const MAX_BODY_BYTES = 16 * 1024
/** Budget d'une analyse complète (lecture des outils + appel IA). */
const ASSISTANT_REQUEST_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.ASSISTANT_REQUEST_TIMEOUT_MS || 45_000)
)
/** Plafond de tokens de sortie appliqué côté fournisseur. */
const ASSISTANT_MAX_OUTPUT_TOKENS = Math.max(
  64,
  Number(process.env.ASSISTANT_MAX_OUTPUT_TOKENS || 800)
)
/** Nombre de messages d'historique transmis au modèle. */
const CONVERSATION_HISTORY_LIMIT = 8
/** Fenêtre d'historique relue pour la mémoire analytique et le contexte. */
const MESSAGE_CONTEXT_WINDOW = 50

const ChatRequestSchema = z.object({
  storeId: z.string().uuid().nullish(),
  threadId: z.string().uuid().nullish(),
  requestId: z.string().uuid(),
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

  // Clé d'idempotence obligatoire : sans elle, aucun rejeu fiable n'est possible.
  const requestId = normalizeId(source.requestId)
  if (!requestId) throw new Error('IDEMPOTENCY_KEY_REQUIRED')

  const parsed = ChatRequestSchema.safeParse({
    storeId: normalizeId(source.storeId),
    threadId: normalizeId(source.threadId),
    requestId,
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

    const contentLength = Number(request.headers.get('content-length') || 0)
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      throw new Error('MESSAGE_TOO_LONG')
    }

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

    if (storeMetaError) {
      throw new Error('STORE_ACCESS_CHECK_FAILED')
    }

    // Boutique invisible sous RLS (appartenance révoquée entre-temps) : refus.
    if (!storeMeta) {
      throw new Error('FORBIDDEN_STORE')
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
    const requestId = body.requestId
    const fingerprint = await computeRequestFingerprint(
      canonicalRequestPayload({
        storeId: selectedStoreId,
        threadId: body.threadId ?? null,
        message: body.message,
      })
    )

    // Registre persistant : inactif tant que la migration n'est pas appliquée.
    const registry = await beginAssistantRequest(supabase, {
      requestId,
      fingerprint,
      storeId: selectedStoreId,
      threadId: body.threadId ?? null,
    })

    if (registry.status === 'conflict') throw new Error('IDEMPOTENCY_CONFLICT')
    if (registry.status === 'in_progress') throw new Error('IDEMPOTENCY_IN_PROGRESS')
    if (registry.status === 'replay') {
      const replayedMessage = await getMessageById(supabase, ensuredThreadId, registry.assistantMessageId)
      if (replayedMessage) {
        const replayMetadata = (replayedMessage.metadata || null) as Record<string, unknown> | null
        return NextResponse.json({
          threadId: ensuredThreadId,
          assistantMessage: replayedMessage,
          structured_response: replayMetadata?.structured_response,
          replayed: true,
          credit_status: 'not_charged',
          finalization_atomic: true,
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

    // Repli sans registre : rejeu local via les métadonnées du message. Une
    // même clé avec un contenu ou un périmètre différent n'est jamais rejouée.
    if (body.threadId) {
      const replayed = await findAssistantReplyByRequestId(supabase, ensuredThreadId, requestId)
      if (replayed) {
        const replayMetadata = (replayed.metadata || null) as Record<string, unknown> | null
        const storedFingerprint =
          typeof replayMetadata?.request_fingerprint === 'string' ? replayMetadata.request_fingerprint : null
        if (storedFingerprint && storedFingerprint !== fingerprint) throw new Error('IDEMPOTENCY_CONFLICT')

        return NextResponse.json({
          threadId: ensuredThreadId,
          assistantMessage: replayed,
          structured_response: replayMetadata?.structured_response,
          replayed: true,
          credit_status: 'not_charged',
          finalization_atomic: false,
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

    // Deux périodes explicitement demandées : la seconde devient la référence.
    // Sans période explicite, `getStoreComparison` reste une comparaison de boutiques.
    let comparisonBaseline: { from: string; to: string } | undefined
    if (intent === 'period_comparison') {
      const comparison = extractComparisonRanges(body.message)
      const baselineRange = comparison?.rangeB
      if (baselineRange && typeof baselineRange === 'object') {
        try {
          const baseline = resolveAssistantBusinessRange({
            start: baselineRange.start,
            end: baselineRange.end,
          })
          comparisonBaseline = { from: baseline.from, to: baseline.to }
        } catch {
          comparisonBaseline = undefined
        }
      }
    }

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
        { request_id: requestId, request_fingerprint: fingerprint }
      )
      const assistantMessage = await addMessage(
        supabase,
        ensuredThreadId,
        'assistant',
        smallResponse.message_text,
        0,
        {
          structured_response: smallResponse,
          request_id: requestId,
          request_fingerprint: fingerprint,
        }
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
    const creditReservation = await reserveCreditsForRequest(supabase, estimatedCredits, requestId)

    const model = getAssistantModelName()

    // Budget d'exécution : l'annulation est propagée jusqu'au fournisseur HTTP.
    const controller = new AbortController()
    let deadlineReached = false
    const deadlineTimer = setTimeout(() => {
      deadlineReached = true
      controller.abort()
    }, ASSISTANT_REQUEST_TIMEOUT_MS)

    let agentResult: Awaited<ReturnType<typeof runSecureAssistantAgent>>
    try {
      agentResult = await runSecureAssistantAgent({
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
        signal: controller.signal,
        maxOutputTokens: ASSISTANT_MAX_OUTPUT_TOKENS,
        comparisonBaseline,
      })
    } catch (agentError) {
      const rawCode = agentError instanceof Error ? agentError.message : ''

      if (creditReservation.status === 'reserved') {
        await releaseCreditReservation(supabase, requestId).catch(() => false)
      }

      if (deadlineReached || rawCode.endsWith('_ABORTED')) {
        console.warn('[assistant] request_aborted', {
          storeId: selectedStoreId,
          deadline: deadlineReached,
          durationMs: Date.now() - startedAt,
        })
        throw new Error(deadlineReached ? 'ASSISTANT_TIMEOUT' : 'REQUEST_ABORTED')
      }

      const controlled = toControlledAgentError(agentError)
      console.error('[assistant] agent_failed', {
        code: controlled.message,
        storeId: selectedStoreId,
        durationMs: Date.now() - startedAt,
      })
      throw controlled
    } finally {
      clearTimeout(deadlineTimer)
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
    const nextTitle = isFirstExchange
      ? resolveAiThreadTitle(structuredResponse.conversation_title) || buildAutoThreadTitle(body.message, structuredResponse.message_text)
      : undefined

    // Finalisation : atomique UNIQUEMENT si la RPC dédiée est appliquée et activée.
    // Par défaut, chemin séquentiel : réponse sans débit possible, jamais l'inverse.
    const finalization = await finalizeAssistantTurn({
      supabase,
      threadId: ensuredThreadId,
      userId: user.id,
      storeId: selectedStoreId,
      requestId,
      fingerprint,
      intent,
      userMessage: body.message,
      assistantContent: structuredResponse.message_text,
      assistantMetadata: {
        structured_response: structuredResponse,
        analytic_memory: updatedMemory,
        request_id: requestId,
        request_fingerprint: fingerprint,
      },
      creditsUsed,
      provider: providerResult,
      nextTitle,
    })

    const chargedCredits = finalization.creditStatus === 'charged' ? creditsUsed : 0

    console.info('[assistant] request_done', {
      intent,
      storeId: selectedStoreId,
      durationMs: Date.now() - startedAt,
      creditsUsed,
      charge: finalization.creditStatus,
      atomic: finalization.atomic,
      provider: providerResult.providerName,
      model: providerResult.modelName,
    })

    return NextResponse.json({
      threadId: ensuredThreadId,
      assistantMessage: finalization.assistantMessage,
      usage: {
        creditsUsed,
        inputTokens: providerResult.inputTokens,
        outputTokens: providerResult.outputTokens,
        providerName: providerResult.providerName,
        modelName: providerResult.modelName,
        providerCostUsd: providerResult.providerCostUsd,
      },
      structured_response: structuredResponse,
      warning: finalization.warning,
      credit_status: finalization.creditStatus,
      finalization_atomic: finalization.atomic,
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
