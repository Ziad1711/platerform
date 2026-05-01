import { NextResponse } from 'next/server'
import { addMessage, createThread, getThread, listMessages, touchThread } from '@/lib/assistant/chat'
import { computeCreditsUsed, debitCredits, ensureCreditsAvailable, estimateCreditsForPrompt, toWalletSnapshot } from '@/lib/assistant/credits'
import { asksForOtherStore, resolveIntent, resolveRangeFromQuestion } from '@/lib/assistant/intents'
import { getAssistantModelName } from '@/lib/assistant/providers'
import { buildGreetingResponse, buildSmallTalkResponse, buildStructuredResponseFromContext } from '@/lib/assistant/response'
import { getAccessibleStoreIds, getErrorStatus, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import type { AssistantStructuredResponse } from '@/lib/assistant/types'
import { runSecureAssistantAgent } from '@/lib/assistant/agent'

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
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = await request.json()

    const storeId = body?.storeId as string | undefined
    const message = String(body?.message || '').trim()
    let threadId = body?.threadId as string | undefined

    if (!message) throw new Error('EMPTY_MESSAGE')

    let targetStoreIds: string[] = []
    if (storeId) {
      await verifyStoreAccess(supabase, user.id, storeId)
      targetStoreIds = [storeId]
    } else {
      targetStoreIds = await getAccessibleStoreIds(supabase, user.id)
      if (targetStoreIds.length === 0) throw new Error('NO_ACCESSIBLE_STORE')
    }

    const selectedStoreId = storeId || targetStoreIds[0]
    if (!selectedStoreId) throw new Error('NO_STORE_SELECTED')

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
    const userMainCurrency = String((profileMeta as any)?.preferred_currency || resolvedStoreCurrency)

    if (!threadId) {
      const created = await createThread(supabase, user.id, storeId || null, message.slice(0, 60))
      threadId = created.id
    } else {
      await getThread(supabase, threadId, user.id, selectedStoreId)
    }

    if (!threadId) {
      throw new Error('THREAD_CREATE_FAILED')
    }

    const ensuredThreadId = threadId

    const previousMessages = await listMessages(supabase, ensuredThreadId)
    const isFirstExchange = previousMessages.length === 0

    if (asksForOtherStore(message)) {
      const structuredResponse: AssistantStructuredResponse = {
        message_text:
          'Je ne peux pas accéder à un autre store. Je peux seulement analyser le store actif auquel vous avez accès.',
        suggestions: ['Analyse mon business', 'Montre-moi mes ventes', 'Analyse mon stock'],
        activity_steps: [{ label: 'Vérification des accès' }, { label: 'Refus multi-tenant sécurisé' }],
        chart: false,
      }

      await addMessage(supabase, ensuredThreadId, 'user', message, 0)
      const assistantMessage = await addMessage(
        supabase,
        ensuredThreadId,
        'assistant',
        structuredResponse.message_text,
        0,
        { structured_response: structuredResponse }
      )
      const nextTitle = isFirstExchange ? resolveAiThreadTitle(structuredResponse.conversation_title) : undefined
      await touchThread(supabase, ensuredThreadId, nextTitle)

      return NextResponse.json({
        threadId: ensuredThreadId,
        assistantMessage,
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

    const conversationalHistory = previousMessages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-8)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

    const intent = resolveIntent(message)
    const range = resolveRangeFromQuestion(message)

    if (intent === 'greeting' || intent === 'small_talk') {
      const structuredResponse = intent === 'greeting' ? buildGreetingResponse() : buildSmallTalkResponse()
      structuredResponse.activity_steps = [{ label: 'Interaction conversationnelle' }]

      await addMessage(supabase, ensuredThreadId, 'user', message, 0)
      const assistantMessage = await addMessage(
        supabase,
        ensuredThreadId,
        'assistant',
        structuredResponse.message_text,
        0,
        { structured_response: structuredResponse }
      )
      const nextTitle = isFirstExchange ? resolveAiThreadTitle(structuredResponse.conversation_title) : undefined
      await touchThread(supabase, ensuredThreadId, nextTitle)

      return NextResponse.json({
        threadId: ensuredThreadId,
        assistantMessage,
        structured_response: structuredResponse,
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

    const estimatedCredits = estimateCreditsForPrompt([
      message,
      ...conversationalHistory.map((m) => m.content),
    ])

    const { wallet } = await ensureCreditsAvailable(supabase, user.id, estimatedCredits)

    const model = getAssistantModelName()

    const agentResult = await runSecureAssistantAgent({
      supabase,
      storeIds: [selectedStoreId],
      storeContext: {
        storeId: selectedStoreId,
        storeName: String(storeMeta.name || 'Store'),
        storeCurrency: resolvedStoreCurrency,
        userMainCurrency,
      },
      intent,
      range,
      userMessage: message,
      conversationHistory: conversationalHistory,
      providerModel: model,
    })

    const providerResult = agentResult.providerUsage

    const creditsUsed = computeCreditsUsed(providerResult.inputTokens, providerResult.outputTokens)
    const walletSnapshot = toWalletSnapshot(wallet)
    if (walletSnapshot.remainingCredits < creditsUsed) {
      throw new Error('INSUFFICIENT_CREDITS')
    }

    const structuredResponse = agentResult.structuredResponse || buildStructuredResponseFromContext(intent, providerResult.text, {})

    await addMessage(supabase, ensuredThreadId, 'user', message, 0)
    const assistantMessage = await addMessage(
      supabase,
      ensuredThreadId,
      'assistant',
      structuredResponse.message_text,
      creditsUsed,
      { structured_response: structuredResponse }
    )
    const nextTitle = isFirstExchange
      ? resolveAiThreadTitle(structuredResponse.conversation_title) || buildAutoThreadTitle(message, structuredResponse.message_text)
      : undefined
    await touchThread(supabase, ensuredThreadId, nextTitle)

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

    const usageWarning = usageError ? usageError.message : null
    if (usageError) {
      console.error('ai_usage insert failed:', usageError.message)
    }

    await debitCredits(supabase, wallet.id, wallet.credits_used, creditsUsed)

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
      warning: usageWarning,
      wallet: {
        monthlyCredits: walletSnapshot.monthlyCredits,
        creditsUsed: walletSnapshot.creditsUsed + creditsUsed,
        remainingCredits: Math.max(0, walletSnapshot.remainingCredits - creditsUsed),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' },
      { status: getErrorStatus(error) }
    )
  }
}
