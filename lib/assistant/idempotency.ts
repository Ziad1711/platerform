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

export type BeginRequestOutcome =
  | { status: 'proceed' }
  | { status: 'replay'; assistantMessageId: string }
  | { status: 'conflict' }
  | { status: 'in_progress' }
  | { status: 'registry_unavailable' }

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
    return { status: 'registry_unavailable' }
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { state?: string; assistant_message_id?: string | null }
    | null
    | undefined

  if (!row) return { status: 'proceed' }

  // Réponse déjà finalisée : on rejoue l'identifiant du message, jamais un
  // contenu fourni par le client. Un message supprimé interdit le rejeu.
  if (row.state === 'completed') {
    return row.assistant_message_id
      ? { status: 'replay', assistantMessageId: String(row.assistant_message_id) }
      : { status: 'proceed' }
  }

  // 'in_progress' renvoyé sans erreur = bail détenu par CET appelant : on poursuit.
  // Un bail détenu par une autre instance lève IDEMPOTENCY_IN_PROGRESS (ci-dessus).
  return { status: 'proceed' }
}

/** Clôture nominale du registre (après finalisation fiable des écritures). */
export async function completeAssistantRequest(
  supabase: SupabaseServerClient,
  identity: Pick<AssistantRequestIdentity, 'requestId'>,
  assistantMessage: unknown
): Promise<boolean> {
  if (!ASSISTANT_IDEMPOTENCY_REGISTRY_ENABLED) return false

  const { error } = await supabase.rpc(ASSISTANT_IDEMPOTENCY_RPC.complete, {
    p_request_id: identity.requestId,
    p_assistant_message: assistantMessage ?? null,
  })

  return !error
}

/** Clôture en échec : libère le bail pour permettre une reprise contrôlée. */
export async function failAssistantRequest(
  supabase: SupabaseServerClient,
  identity: Pick<AssistantRequestIdentity, 'requestId'>,
  reason: string
): Promise<boolean> {
  if (!ASSISTANT_IDEMPOTENCY_REGISTRY_ENABLED) return false

  const { error } = await supabase.rpc(ASSISTANT_IDEMPOTENCY_RPC.fail, {
    p_request_id: identity.requestId,
    p_reason: reason.slice(0, 200),
  })

  return !error
}
