import { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export async function listThreads(supabase: SupabaseServerClient, userId: string, storeId?: string | null) {
  let query = supabase
    .from('chat_threads')
    .select('id, title, is_pinned, created_at, updated_at')
    .eq('user_id', userId)
    .order('is_pinned', { ascending: false })
    .order('updated_at', { ascending: false })

  if (storeId) {
    query = query.eq('store_id', storeId)
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

export async function getThread(supabase: SupabaseServerClient, threadId: string, userId: string, storeId: string) {
  let query = supabase
    .from('chat_threads')
    .select('id, title, is_pinned, user_id, store_id')
    .eq('id', threadId)
    .eq('user_id', userId)

  if (storeId) {
    query = query.eq('store_id', storeId)
  }

  const { data, error } = await query.maybeSingle()

  if (error) throw new Error('THREAD_FETCH_FAILED')
  if (!data) throw new Error('THREAD_NOT_FOUND')

  return data
}

export async function listMessages(supabase: SupabaseServerClient, threadId: string) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, thread_id, role, content, credits_used, metadata, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })

  if (error) throw new Error('MESSAGES_LIST_FAILED')
  return data || []
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
