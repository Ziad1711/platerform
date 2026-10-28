/**
 * Finalisation d'un tour de conversation : message utilisateur, message
 * assistant, journal d'usage et débit de crédits.
 *
 * Deux chemins :
 * - `atomic`  : une seule RPC (`rpc_assistant_finalize_request`), activée par
 *               `ASSISTANT_FINALIZE_ATOMIC=enabled` **après** application de la
 *               migration et validation. C'est le seul chemin transactionnel.
 * - `fallback`: écritures séquentielles, comportement actuel. **Ce chemin n'est
 *               pas atomique** : un échec intermédiaire peut laisser une réponse
 *               sans débit (jamais un débit sans réponse).
 *
 * Aucune garantie d'atomicité ne doit être annoncée tant que la migration n'est
 * pas appliquée et testée.
 */
import { addMessage, touchThread } from '@/lib/assistant/chat'
import { chargeCredits, type CreditChargeStatus } from '@/lib/assistant/credits'
import { completeAssistantRequest } from '@/lib/assistant/idempotency'
import type { AssistantProviderOutput } from '@/lib/assistant/providers/types'
import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export const ASSISTANT_FINALIZE_ATOMIC_ENABLED =
  (process.env.ASSISTANT_FINALIZE_ATOMIC || '').trim().toLowerCase() === 'enabled'

export const ASSISTANT_FINALIZE_RPC = 'rpc_assistant_finalize_request'

export interface FinalizeTurnInput {
  supabase: SupabaseServerClient
  threadId: string
  userId: string
  storeId: string
  requestId: string
  fingerprint: string
  intent: string
  userMessage: string
  assistantContent: string
  assistantMetadata: Record<string, unknown>
  creditsUsed: number
  provider: AssistantProviderOutput
  nextTitle?: string
}

export interface FinalizeTurnResult {
  /** `false` = écritures séquentielles, donc non atomiques. */
  atomic: boolean
  assistantMessage: unknown
  creditStatus: CreditChargeStatus | 'not_charged'
  warning: string | null
}

function buildUsageRow(input: FinalizeTurnInput) {
  return {
    user_id: input.userId,
    store_id: input.storeId,
    thread_id: input.threadId,
    feature: 'chatbot',
    credits_used: input.creditsUsed,
    input_tokens: input.provider.inputTokens,
    output_tokens: input.provider.outputTokens,
    provider_name: input.provider.providerName,
    model_name: input.provider.modelName,
    provider_cost_usd: input.provider.providerCostUsd,
  }
}

export async function finalizeAssistantTurn(input: FinalizeTurnInput): Promise<FinalizeTurnResult> {
  if (ASSISTANT_FINALIZE_ATOMIC_ENABLED) {
    const { data, error } = await input.supabase.rpc(ASSISTANT_FINALIZE_RPC, {
      p_thread_id: input.threadId,
      p_request_id: input.requestId,
      p_request_fingerprint: input.fingerprint,
      p_store_id: input.storeId,
      p_intent: input.intent,
      p_user_message: input.userMessage,
      p_assistant_content: input.assistantContent,
      p_assistant_metadata: input.assistantMetadata,
      p_credits: input.creditsUsed,
      p_usage: buildUsageRow(input),
      p_next_title: input.nextTitle ?? null,
    })

    if (!error) {
      const row = (Array.isArray(data) ? data[0] : data) as
        | { assistant_message?: unknown; credit_status?: string }
        | null
        | undefined

      const creditStatus =
        row?.credit_status === 'charged' || row?.credit_status === 'insufficient' || row?.credit_status === 'failed'
          ? row.credit_status
          : 'charged'

      await completeAssistantRequest(input.supabase, { requestId: input.requestId }, row?.assistant_message)

      return {
        atomic: true,
        assistantMessage: row?.assistant_message ?? null,
        creditStatus,
        warning: creditStatus === 'charged' ? null : 'La consommation de crédits n’a pas pu être confirmée.',
      }
    }

    // RPC absente ou en échec : on ne simule pas l'atomicité.
    console.error('[assistant] finalize_rpc_failed', { code: error.code || 'unknown' })
  }

  let warning: string | null = null

  await addMessage(
    input.supabase,
    input.threadId,
    'user',
    input.userMessage,
    0,
    { request_id: input.requestId, request_fingerprint: input.fingerprint }
  )

  const assistantMessage = await addMessage(
    input.supabase,
    input.threadId,
    'assistant',
    input.assistantContent,
    input.creditsUsed,
    input.assistantMetadata
  )

  if (input.nextTitle) {
    await touchThread(input.supabase, input.threadId, input.nextTitle)
  } else {
    await touchThread(input.supabase, input.threadId)
  }

  const { error: usageError } = await input.supabase.from('ai_usage').insert(buildUsageRow(input))
  if (usageError) {
    warning = 'Le journal d’usage IA n’a pas pu être enregistré.'
    console.error('[assistant] usage_log_failed', { code: usageError.code || 'unknown' })
  }

  const charge = await chargeCredits(input.supabase, input.creditsUsed)
  if (charge.status !== 'charged') {
    warning = warning || 'La consommation de crédits n’a pas pu être confirmée.'
    console.error('[assistant] credit_charge_failed', { status: charge.status })
  }

  return {
    atomic: false,
    assistantMessage,
    creditStatus: charge.status,
    warning,
  }
}
