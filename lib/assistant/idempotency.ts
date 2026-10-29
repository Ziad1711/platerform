/**
 * Registre persistant d'idempotence — PRÉPARATION.
 *
 * Objectif : garantir « un résultat et un débit au plus » par requête, y compris
 * entre instances. Le registre vit en base (`assistant_requests`, proposition
 * `docs/assistant/sql/03_assistant_idempotency_registry.proposed.sql`) et reste
 * INACTIF tant que la migration n'est pas appliquée et validée.
 *
 * Tant que le registre est inactif, le rejeu repose sur les métadonnées des
 * messages (`request_id` + `request_fingerprint`) : utile pour un double clic,
 * insuffisant entre instances.
 */
import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export const ASSISTANT_IDEMPOTENCY_REGISTRY_ENABLED =
  (process.env.ASSISTANT_IDEMPOTENCY_REGISTRY || '').trim().toLowerCase() === 'enabled'

export const ASSISTANT_IDEMPOTENCY_RPC = {
  begin: 'rpc_assistant_begin_request',
  bindThread: 'rpc_assistant_bind_request_thread',
  complete: 'rpc_assistant_complete_request',
  fail: 'rpc_assistant_fail_request',
} as const

export interface AssistantRequestIdentity {
  requestId: string
  fingerprint: string
  storeId: string
  threadId: string | null
}

/**
 * Empreinte canonique de la requête : clé + contenu + périmètre. Deux appels
 * portant la même clé mais un contenu ou une boutique différents ne sont pas
 * un rejeu : ils sont en conflit.
 */
export function canonicalRequestPayload(input: {
  storeId: string
  threadId: string | null
  message: string
  intent?: string
  range?: string
}) {
  return JSON.stringify({
    v: 1,
    store: input.storeId,
    thread: input.threadId ?? null,
    message: input.message.trim().normalize('NFC'),
    intent: input.intent ?? null,
    range: input.range ?? null,
  })
}

/** SHA-256 hexadécimal (WebCrypto : aucun module natif requis). */
export async function computeRequestFingerprint(payload: string): Promise<string> {
  const bytes = new TextEncoder().encode(payload)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export type AssistantCreditStatus = 'charged' | 'insufficient' | 'failed' | 'not_charged'

export type BeginRequestOutcome =
  | { status: 'proceed'; attemptToken: string | null }
  | { status: 'replay'; threadId: string; assistantMessageId: string | null; creditStatus: AssistantCreditStatus }
  | { status: 'conflict' }
  | { status: 'in_progress' }
  | { status: 'registry_unavailable' }

export function toCreditStatus(value: unknown): AssistantCreditStatus {
  return value === 'charged' || value === 'insufficient' || value === 'failed' ? value : 'not_charged'
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REGISTRY_STATES = new Set(['in_progress', 'completed', 'failed'])
const CREDIT_STATUSES = new Set(['charged', 'insufficient', 'failed', 'not_charged'])

/** Réponse RPC incohérente : on bloque avant l'appel IA, jamais de repli. */
function invalidRegistryResponse(reason: string): never {
  console.error('[assistant] registry_response_invalid', { reason })
  throw new Error('ASSISTANT_BACKEND_UNAVAILABLE')
}

function asNullableUuid(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) invalidRegistryResponse(field)
  return value
}

function asStrictUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) invalidRegistryResponse(field)
  return value
}

function asNonNegativeInteger(value: unknown, field: string): number {
  // PostgreSQL renvoie parfois `bigint`/`numeric` en texte : on accepte la
  // forme décimale entière, jamais un flottant ni une valeur négative.
  const numeric = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value
  if (typeof numeric !== 'number' || !Number.isSafeInteger(numeric) || numeric < 0) {
    invalidRegistryResponse(field)
  }
  return numeric
}

interface ValidatedBeginRow {
  state: 'in_progress' | 'completed' | 'failed'
  threadId: string | null
  attemptToken: string
  assistantMessageId: string | null
  creditStatus: AssistantCreditStatus
}

/**
 * Validation runtime stricte de `rpc_assistant_begin_request`.
 * Toute valeur incohérente (état inconnu, UUID invalide, statut financier
 * inattendu) bloque la requête : aucun type assertion ne suffit.
 */
export function validateBeginRow(raw: unknown): ValidatedBeginRow {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalidRegistryResponse('row')

  const row = raw as Record<string, unknown>
  const state = typeof row.state === 'string' ? row.state : ''
  if (!REGISTRY_STATES.has(state)) invalidRegistryResponse('state')

  const creditStatus = typeof row.credit_status === 'string' ? row.credit_status : ''
  if (!CREDIT_STATUSES.has(creditStatus)) invalidRegistryResponse('credit_status')

  return {
    state: state as ValidatedBeginRow['state'],
    threadId: asNullableUuid(row.thread_id, 'thread_id'),
    attemptToken: asStrictUuid(row.attempt_token, 'attempt_token'),
    assistantMessageId: asNullableUuid(row.assistant_message_id, 'assistant_message_id'),
    creditStatus: creditStatus as AssistantCreditStatus,
  }
}

/** Validation des compteurs de finalisation (implémentation dans credit-invariants). */
export { validateFinalizeCounters } from '@/lib/assistant/credit-invariants'

/**
 * Réservation d'une requête dans le registre persistant.
 *
 * Retourne `registry_unavailable` sans appel réseau quand la fonctionnalité
 * n'est pas activée : l'appelant applique alors le repli local, sans prétendre
 * à une garantie inter-instances.
 */
export async function beginAssistantRequest(
  supabase: SupabaseServerClient,
  identity: AssistantRequestIdentity
): Promise<BeginRequestOutcome> {
  if (!ASSISTANT_IDEMPOTENCY_REGISTRY_ENABLED) return { status: 'registry_unavailable' }

  const { data, error } = await supabase.rpc(ASSISTANT_IDEMPOTENCY_RPC.begin, {
    p_request_id: identity.requestId,
    p_store_id: identity.storeId,
    p_thread_id: identity.threadId,
    p_fingerprint: identity.fingerprint,
  })

  if (error) {
    const message = String(error.message || '')
    if (message.includes('IDEMPOTENCY_CONFLICT')) return { status: 'conflict' }
    if (message.includes('IDEMPOTENCY_IN_PROGRESS') || message.includes('IDEMPOTENCY_LEASE_BUSY')) {
      return { status: 'in_progress' }
    }
    throw new Error('ASSISTANT_BACKEND_UNAVAILABLE')
  }

  const rawRow = Array.isArray(data) ? data[0] : data
  // Validation runtime stricte : état, UUID, jeton et statut financier.
  const row = validateBeginRow(rawRow)

  // Réponse déjà finalisée : rejeu du message + statut de débit réel (jamais
  // « non facturé » par défaut, qui masquerait une facturation antérieure).
  if (row.state === 'completed') {
    return {
      status: 'replay',
      threadId: row.threadId ?? '',
      assistantMessageId: row.assistantMessageId,
      creditStatus: row.creditStatus,
    }
  }

  return { status: 'proceed', attemptToken: row.attemptToken }
}

/** Lie le thread créé après acquisition au jeton courant (fencing). */
export async function bindAssistantRequestThread(
  supabase: SupabaseServerClient,
  identity: { requestId: string; attemptToken: string; threadId: string }
): Promise<void> {
  if (!ASSISTANT_IDEMPOTENCY_REGISTRY_ENABLED) return

  const { error } = await supabase.rpc(ASSISTANT_IDEMPOTENCY_RPC.bindThread, {
    p_request_id: identity.requestId,
    p_attempt_token: identity.attemptToken,
    p_thread_id: identity.threadId,
  })

  if (error) throw new Error('IDEMPOTENCY_TOKEN_MISMATCH')
}

/** Clôture nominale du registre (après finalisation fiable des écritures).
 *
 * Contrat SQL 03b : `p_credits_consumed` = consommation réelle calculée sur les
 * tokens, `p_credits_charged` = montant RÉELLEMENT débité (0 si non facturé).
 * Sans message assistant valide, la clôture est refusée côté base : on renvoie
 * `false` sans appel.
 */
export async function completeAssistantRequest(
  supabase: SupabaseServerClient,
  identity: { userId: string; requestId: string; attemptToken: string },
  assistantMessageId: string | null,
  creditStatus: AssistantCreditStatus,
  creditsConsumed: number,
  creditsCharged: number
): Promise<boolean> {
  if (!ASSISTANT_IDEMPOTENCY_REGISTRY_ENABLED) return false
  if (!assistantMessageId) return false

  const consumed = Math.max(0, Math.trunc(Number(creditsConsumed || 0)))
  const charged = Math.max(0, Math.trunc(Number(creditsCharged || 0)))

  // Garde-fou local identique aux contraintes SQL (aucun débit > consommation,
  // aucun montant débité pour un statut non facturé).
  if (charged > consumed) return false
  if (creditStatus !== 'charged' && charged !== 0) return false
  if (creditStatus === 'charged' && charged !== consumed) return false

  const { error } = await supabase.rpc(ASSISTANT_IDEMPOTENCY_RPC.complete, {
    p_user_id: identity.userId,
    p_request_id: identity.requestId,
    p_attempt_token: identity.attemptToken,
    p_assistant_message_id: assistantMessageId,
    p_credit_status: creditStatus,
    p_credits_consumed: consumed,
    p_credits_charged: charged,
  })

  return !error
}

/** Clôture en échec : libère le bail pour permettre une reprise contrôlée. */
export async function failAssistantRequest(
  supabase: SupabaseServerClient,
  identity: { requestId: string; attemptToken?: string | null },
  reason: string
): Promise<boolean> {
  if (!ASSISTANT_IDEMPOTENCY_REGISTRY_ENABLED) return false
  if (!identity.attemptToken) return false

  const { error } = await supabase.rpc(ASSISTANT_IDEMPOTENCY_RPC.fail, {
    p_request_id: identity.requestId,
    p_attempt_token: identity.attemptToken,
    p_reason: reason.slice(0, 200),
  })

  return !error
}
