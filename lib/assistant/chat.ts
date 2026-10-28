import { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export const THREADS_PAGE_SIZE = 50
export const MESSAGES_PAGE_SIZE = 50
export const MESSAGES_MAX_PAGE_SIZE = 200

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function clampPageValue(value: number | undefined, fallback: number, max: number) {
  const numeric = Number.isFinite(value) ? Number(value) : fallback
  return Math.min(max, Math.max(1, Math.trunc(numeric)))
}

/**
 * Liste les conversations de l'utilisateur, bornées et paginées.
 * Les conversations historiques sans boutique (`store_id` null) restent
 * visibles : elles appartiennent au même utilisateur et ne peuvent pas
 * exposer les données d'un autre tenant (RLS + filtre `user_id`).
 */
export async function listThreads(
  supabase: SupabaseServerClient,
  userId: string,
  storeId?: string | null,
  options?: { limit?: number; offset?: number }
) {
  const limit = clampPageValue(options?.limit, THREADS_PAGE_SIZE, MESSAGES_MAX_PAGE_SIZE)
  const offset = Math.max(0, Math.trunc(options?.offset || 0))

  let query = supabase
    .from('chat_threads')
    .select('id, title, is_pinned, created_at, updated_at, store_id')
    .eq('user_id', userId)
    .order('is_pinned', { ascending: false })
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (storeId) {
    if (!isUuid(storeId)) throw new Error('INVALID_STORE_ID')
    query = query.or(`store_id.eq.${storeId},store_id.is.null`)
  }

  const { data, error } = await query

  if (error) throw new Error('THREADS_LIST_FAILED')
  return data || []
}

export async function createThread(
  supabase: SupabaseServerClient,
  userId: string,
  storeId?: string | null,
  title?: string | null
) {
  const { data, error } = await supabase
    .from('chat_threads')
    .insert({
      user_id: userId,
      store_id: storeId,
      title: title || 'Nouvelle conversation',
    })
    .select('id, title, is_pinned, created_at, updated_at')
    .single()

  if (error || !data) throw new Error('THREAD_CREATE_FAILED')
  return data
}

/**
 * Récupère une conversation de l'utilisateur, avec contrôle de périmètre.
 *
 * - la conversation doit appartenir à l'utilisateur ;
 * - si la requête porte sur une boutique et que la conversation est liée à une
 *   **autre** boutique, l'accès est refusé (`THREAD_STORE_MISMATCH`) ;
 * - les conversations historiques (`store_id` null) restent utilisables : leur
 *   portée est celle de la requête courante, jamais celle d'une autre boutique.
 */
export async function getThread(
  supabase: SupabaseServerClient,
  threadId: string,
  userId: string,
  storeId?: string | null
) {
  if (!isUuid(threadId)) throw new Error('THREAD_NOT_FOUND')

  const { data, error } = await supabase
    .from('chat_threads')
    .select('id, title, is_pinned, user_id, store_id')
    .eq('id', threadId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error('THREAD_FETCH_FAILED')
  if (!data) throw new Error('THREAD_NOT_FOUND')

  if (storeId && data.store_id && String(data.store_id) !== storeId) {
    throw new Error('THREAD_STORE_MISMATCH')
  }

  return data
}

/**
 * Messages d'une conversation, bornés.
 *
 * Lecture des `limit` messages les plus récents (offset compté depuis le plus
 * récent), puis restitution en ordre chronologique croissant pour l'affichage.
 */
export async function listMessages(
  supabase: SupabaseServerClient,
  threadId: string,
  options?: { limit?: number; offset?: number }
) {
  const limit = clampPageValue(options?.limit, MESSAGES_PAGE_SIZE, MESSAGES_MAX_PAGE_SIZE)
  const offset = Math.max(0, Math.trunc(options?.offset || 0))

  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, thread_id, role, content, credits_used, metadata, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) throw new Error('MESSAGES_LIST_FAILED')
  return (data || []).reverse()
}

/**
 * Rejeu idempotent : retrouve la réponse déjà produite pour une requête
 * identifiée par `requestId`. Aucun schéma supplémentaire n'est requis : la clé
 * est stockée dans `chat_messages.metadata.request_id`.
 */
export async function findAssistantReplyByRequestId(
  supabase: SupabaseServerClient,
  threadId: string,
  requestId: string
) {
  if (!isUuid(threadId) || !isUuid(requestId)) return null

  const { data: anchors, error } = await supabase
    .from('chat_messages')
    .select('id, created_at')
    .eq('thread_id', threadId)
    .eq('role', 'user')
    .contains('metadata', { request_id: requestId })
    .order('created_at', { ascending: true })
    .limit(1)

  if (error) throw new Error('MESSAGES_LIST_FAILED')
  const anchor = anchors?.[0]
  if (!anchor) return null

  const { data: replies, error: replyError } = await supabase
    .from('chat_messages')
    .select('id, thread_id, role, content, credits_used, metadata, created_at')
    .eq('thread_id', threadId)
    .eq('role', 'assistant')
    .gt('created_at', anchor.created_at)
    .order('created_at', { ascending: true })
    .limit(1)

  if (replyError) throw new Error('MESSAGES_LIST_FAILED')
  return replies?.[0] || null
}

export async function addMessage(
  supabase: SupabaseServerClient,
  threadId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  creditsUsed = 0,
  metadata?: Record<string, unknown> | null
) {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      thread_id: threadId,
      role,
      content,
      credits_used: creditsUsed,
      metadata: metadata || null,
    })
    .select('id, thread_id, role, content, credits_used, metadata, created_at')
    .single()

  if (error || !data) throw new Error('MESSAGE_CREATE_FAILED')
  return data
}

export async function touchThread(supabase: SupabaseServerClient, threadId: string, title?: string) {
  const payload: { updated_at: string; title?: string } = {
    updated_at: new Date().toISOString(),
  }

  if (title) payload.title = title

  const { error } = await supabase.from('chat_threads').update(payload).eq('id', threadId)
  if (error) throw new Error('THREAD_TOUCH_FAILED')
}

export async function updateThread(
  supabase: SupabaseServerClient,
  threadId: string,
  userId: string,
  payload: { title?: string; is_pinned?: boolean }
) {
  const updatePayload: { title?: string; is_pinned?: boolean; updated_at: string } = {
    updated_at: new Date().toISOString(),
  }

  if (typeof payload.title === 'string') {
    const clean = payload.title.trim()
    updatePayload.title = clean || 'Nouvelle conversation'
  }

  if (typeof payload.is_pinned === 'boolean') {
    updatePayload.is_pinned = payload.is_pinned
  }

  const { data, error } = await supabase
    .from('chat_threads')
    .update(updatePayload)
    .eq('id', threadId)
    .eq('user_id', userId)
    .select('id, title, is_pinned, created_at, updated_at')
    .single()

  if (error || !data) throw new Error('THREAD_UPDATE_FAILED')
  return data
}

export async function deleteThread(supabase: SupabaseServerClient, threadId: string, userId: string) {
  const { error } = await supabase
    .from('chat_threads')
    .delete()
    .eq('id', threadId)
    .eq('user_id', userId)

  if (error) throw new Error('THREAD_DELETE_FAILED')
}
