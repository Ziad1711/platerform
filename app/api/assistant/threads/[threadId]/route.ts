import { NextResponse } from 'next/server'
import { deleteThread, getThread, updateThread } from '@/lib/assistant/chat'
import {
  assertThreadScopeAccess,
  assertTrustedOrigin,
  requireAuthenticatedUser,
  toPublicError,
} from '@/lib/assistant/security'

const MAX_TITLE_LENGTH = 120

interface Params {
  params: Promise<{ threadId: string }>
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    assertTrustedOrigin(request)

    const { threadId } = await params
    const { supabase, user } = await requireAuthenticatedUser()

    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      throw new Error('INVALID_REQUEST')
    }

    const body = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>
    const action = String(body.action || '')

    // Conversation possédée + permission effective sur sa boutique.
    const thread = await getThread(supabase, threadId, user.id)
    await assertThreadScopeAccess(supabase, user.id, thread.store_id as string | null)

    if (action === 'rename') {
      const title = String(body.title || '').trim().slice(0, MAX_TITLE_LENGTH)
      if (!title) throw new Error('INVALID_THREAD_TITLE')

      const updated = await updateThread(supabase, threadId, user.id, { title })
      return NextResponse.json({ thread: updated })
    }

    if (action === 'toggle_pin') {
      const isPinned = Boolean(body.isPinned)
      const updated = await updateThread(supabase, threadId, user.id, { is_pinned: isPinned })
      return NextResponse.json({ thread: updated })
    }

    throw new Error('INVALID_THREAD_ACTION')
  } catch (error) {
    const publicError = toPublicError(error)
    return NextResponse.json(
      { error: publicError.code, message: publicError.message },
      { status: publicError.status }
    )
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    assertTrustedOrigin(request)

    const { threadId } = await params
    const { supabase, user } = await requireAuthenticatedUser()

    const thread = await getThread(supabase, threadId, user.id)
    await assertThreadScopeAccess(supabase, user.id, thread.store_id as string | null)

    await deleteThread(supabase, threadId, user.id)

    return NextResponse.json({ success: true })
  } catch (error) {
    const publicError = toPublicError(error)
    return NextResponse.json(
      { error: publicError.code, message: publicError.message },
      { status: publicError.status }
    )
  }
}
