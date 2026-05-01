import { NextResponse } from 'next/server'
import { deleteThread, getThread, updateThread } from '@/lib/assistant/chat'
import { getErrorStatus, requireAuthenticatedUser } from '@/lib/assistant/security'

interface Params {
  params: Promise<{ threadId: string }>
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { threadId } = await params
    const { supabase, user } = await requireAuthenticatedUser()
    const body = await request.json()

    const action = String(body?.action || '')
    await getThread(supabase, threadId, user.id, '')

    if (action === 'rename') {
      const title = String(body?.title || '').trim()
      if (!title) throw new Error('INVALID_THREAD_TITLE')

      const thread = await updateThread(supabase, threadId, user.id, { title })
      return NextResponse.json({ thread })
    }

    if (action === 'toggle_pin') {
      const isPinned = Boolean(body?.isPinned)
      const thread = await updateThread(supabase, threadId, user.id, { is_pinned: isPinned })
      return NextResponse.json({ thread })
    }

    throw new Error('INVALID_THREAD_ACTION')
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' },
      { status: getErrorStatus(error) }
    )
  }
}

export async function DELETE(_: Request, { params }: Params) {
  try {
    const { threadId } = await params
    const { supabase, user } = await requireAuthenticatedUser()

    await getThread(supabase, threadId, user.id, '')
    await deleteThread(supabase, threadId, user.id)

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' },
      { status: getErrorStatus(error) }
    )
  }
}
