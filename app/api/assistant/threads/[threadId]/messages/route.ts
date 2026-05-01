import { NextResponse } from 'next/server'
import { getThread, listMessages } from '@/lib/assistant/chat'
import { getAccessibleStoreIds, getErrorStatus, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'

interface Params {
  params: Promise<{ threadId: string }>
}

export async function GET(request: Request, { params }: Params) {
  try {
    const { threadId } = await params
    const { supabase, user } = await requireAuthenticatedUser()
    const { searchParams } = new URL(request.url)
    const storeId = searchParams.get('storeId')

    if (storeId) {
      await verifyStoreAccess(supabase, user.id, storeId)
    } else {
      const ids = await getAccessibleStoreIds(supabase, user.id)
      if (ids.length === 0) throw new Error('NO_ACCESSIBLE_STORE')
    }

    await getThread(supabase, threadId, user.id, storeId || '')
    const messages = await listMessages(supabase, threadId)

    return NextResponse.json({ messages })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' },
      { status: getErrorStatus(error) }
    )
  }
}
