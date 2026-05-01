import { NextResponse } from 'next/server'
import { createThread, listThreads } from '@/lib/assistant/chat'
import { getAccessibleStoreIds, getErrorStatus, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const { searchParams } = new URL(request.url)
    const storeId = searchParams.get('storeId')

    if (storeId) {
      await verifyStoreAccess(supabase, user.id, storeId)
    } else {
      const ids = await getAccessibleStoreIds(supabase, user.id)
      if (ids.length === 0) throw new Error('NO_ACCESSIBLE_STORE')
    }

    const threads = await listThreads(supabase, user.id, storeId)

    return NextResponse.json({ threads })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' },
      { status: getErrorStatus(error) }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = await request.json()
    const storeId = body?.storeId as string | undefined
    const title = body?.title as string | undefined

    let resolvedStoreId: string | null = null

    if (storeId) {
      await verifyStoreAccess(supabase, user.id, storeId)
      resolvedStoreId = storeId
    } else {
      const ids = await getAccessibleStoreIds(supabase, user.id)
      if (ids.length === 0) throw new Error('NO_ACCESSIBLE_STORE')
      resolvedStoreId = ids[0]
    }

    const thread = await createThread(supabase, user.id, resolvedStoreId, title)

    return NextResponse.json({ thread })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' },
      { status: getErrorStatus(error) }
    )
  }
}
