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
 *
 * Crédits : `creditsConsumed` (tokens réels) et `creditsCharged` (débit réel)
 * sont deux mesures distinctes. Décision provisoire documentée : si le solde
 * est insuffisant, la réponse et le journal sont conservés, le débit est nul et
 * le statut vaut `insufficient`. Ce n'est pas une garantie « tout ou rien »
 * financière ; elle doit être réarbitrée avec la facturation.
 *
 * Mode pilote (verrou ouvert + allowlist non vide) : le chemin `fallback`
 * séquentiel est refusé (`assertAtomicFinalizationRequired`), quel que soit
 * l'état du drapeau `ASSISTANT_FINALIZE_ATOMIC`.
 */
import { addMessage, touchThread } from '@/lib/assistant/chat'
import { chargeCredits, type CreditChargeStatus } from '@/lib/assistant/credits'
import {
  ASSISTANT_IDEMPOTENCY_REGISTRY_ENABLED,
  completeAssistantRequest,
} from '@/lib/assistant/idempotency'
import { validateFinalizeCounters } from '@/lib/assistant/credit-invariants'
import { assertAtomicFinalizationRequired } from '@/lib/assistant/access'
import { requireAssistantBackendClient } from '@/lib/assistant/backend'
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
  /** Jeton de tentative (fencing) retourné par le registre, si activé. */
  attemptToken?: string | null
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
  /** `true` = réponse déjà finalisée relue depuis le registre (aucun débit). */
  replayed: boolean
  assistantMessage: unknown
  creditStatus: CreditChargeStatus | 'not_charged'
  /** Consommation réelle calculée sur les tokens (facturable ou non). */
  creditsConsumed: number
  /** Montant réellement débité du portefeuille (0 si non facturé). */
  creditsCharged: number
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
  // Mode pilote : la finalisation séquentielle (non atomique) est interdite.
  // Aucun repli ne peut donc facturer hors de la transaction unique.
  assertAtomicFinalizationRequired(ASSISTANT_FINALIZE_ATOMIC_ENABLED)

  if (ASSISTANT_FINALIZE_ATOMIC_ENABLED) {
    // Écriture fiable : client backend dédié, jamais le client utilisateur.
    const backend = requireAssistantBackendClient()

    if (ASSISTANT_IDEMPOTENCY_REGISTRY_ENABLED && !input.attemptToken) {
      throw new Error('IDEMPOTENCY_TOKEN_MISMATCH')
    }

    const { data, error } = await backend.rpc(ASSISTANT_FINALIZE_RPC, {
      p_user_id: input.userId,
      p_thread_id: input.threadId,
      p_request_id: input.requestId,
      p_request_fingerprint: input.fingerprint,
      p_attempt_token: input.attemptToken ?? null,
      p_store_id: input.storeId,
      p_intent: input.intent,
      p_user_message: input.userMessage,
      p_assistant_content: input.assistantContent,
      p_assistant_metadata: input.assistantMetadata,
      p_credits: input.creditsUsed,
      p_usage: buildUsageRow(input),
      p_next_title: input.nextTitle ?? null,
    })

    if (error) {
      // Aucune reprise séquentielle : une atomicité exigée ne se dégrade pas.
      console.error('[assistant] finalize_rpc_failed', { code: error.code || 'unknown' })
      throw new Error('FINALIZE_RPC_FAILED')
    }

    const rawRow = Array.isArray(data) ? data[0] : data

    if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
      console.error('[assistant] finalize_rpc_empty')
      throw new Error('FINALIZE_RPC_FAILED')
    }

    const row = rawRow as {
      assistant_message?: unknown
      credit_status?: string
      replayed?: boolean
      credits_consumed?: number
      credits_charged?: number
    }

    if (row.assistant_message === undefined && !row.replayed) {
      console.error('[assistant] finalize_rpc_empty')
      throw new Error('FINALIZE_RPC_FAILED')
    }

    // Validation stricte des compteurs : entiers ≥ 0 et débit ≤ consommation.
    // Une réponse incohérente est rejetée ICI, sans second débit ni reprise.
    const counters = validateFinalizeCounters(row)

    const creditStatus =
      row.credit_status === 'charged' || row.credit_status === 'insufficient' || row.credit_status === 'failed'
        ? row.credit_status
        : 'not_charged'

    // Consommation et débit proviennent de la RPC validée : aucun repli ne peut
    // recalculer une facture ni masquer une incohérence.
    const creditsConsumed = counters.consumed
    const creditsCharged = counters.charged

    return {
      atomic: true,
      replayed: row?.replayed === true,
      assistantMessage: row?.assistant_message ?? null,
      creditStatus,
      creditsConsumed,
      creditsCharged,
      warning: creditStatus === 'charged' ? null : 'La consommation de crédits n’a pas pu être confirmée.',
    }
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

  // P0-01 : le message assistant est écrit par le backend, jamais par le client
  // utilisateur (PostgREST ne doit pas permettre cette falsification).
  const backend = requireAssistantBackendClient()
  const { data: assistantRow, error: assistantError } = await backend
    .from('chat_messages')
    .insert({
      thread_id: input.threadId,
      role: 'assistant',
      content: input.assistantContent,
      credits_used: input.creditsUsed,
      metadata: input.assistantMetadata,
    })
    .select('id, thread_id, role, content, credits_used, metadata, created_at')
    .single()

  if (assistantError || !assistantRow) throw new Error('MESSAGE_CREATE_FAILED')
  const assistantMessage = assistantRow

  if (input.nextTitle) {
    await touchThread(input.supabase, input.threadId, input.nextTitle)
  } else {
    await touchThread(input.supabase, input.threadId)
  }

  // Journal d'usage : écrit par le backend. `authenticated` n'a plus le droit
  // d'insérer dans `ai_usage` (01), ce qui interdit la falsification de la
  // consommation et l'imputation de coûts à une boutique arbitraire.
  const { error: usageError } = await backend.from('ai_usage').insert(buildUsageRow(input))
  if (usageError) {
    warning = 'Le journal d’usage IA n’a pas pu être enregistré.'
    console.error('[assistant] usage_log_failed', { code: usageError.code || 'unknown' })
  }

  const charge = await chargeCredits(input.supabase, input.creditsUsed)
  if (charge.status !== 'charged') {
    warning = warning || 'La consommation de crédits n’a pas pu être confirmée.'
    console.error('[assistant] credit_charge_failed', { status: charge.status })
  }

  const creditsConsumed = Math.max(0, Math.trunc(input.creditsUsed))
  const creditsCharged = charge.status === 'charged' ? creditsConsumed : 0

  if (ASSISTANT_IDEMPOTENCY_REGISTRY_ENABLED && input.attemptToken) {
    await completeAssistantRequest(
      backend,
      { userId: input.userId, requestId: input.requestId, attemptToken: input.attemptToken },
      assistantRow.id as string,
      charge.status,
      creditsConsumed,
      creditsCharged
    )
  }

  return {
    atomic: false,
    replayed: false,
    assistantMessage,
    creditStatus: charge.status,
    creditsConsumed,
    creditsCharged,
    warning,
  }
}
