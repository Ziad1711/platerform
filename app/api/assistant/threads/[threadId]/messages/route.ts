import { NextResponse } from 'next/server'
import { getThread, listMessages } from '@/lib/assistant/chat'
import {
  assertThreadScopeAccess,
  requireAuthenticatedUser,
  toPublicError,
} from '@/lib/assistant/security'

const MAX_PAGE_SIZE = 100

interface Params {
  params: Promise<{ threadId: string }>
}

function readPageNumber(value: string | null, fallback: number) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(numeric)))
}

export async function GET(request: Request, { params }: Params) {
  try {
    const { threadId } = await params
    const { supabase, user } = await requireAuthenticatedUser()
    const { searchParams } = new URL(request.url)
    const storeId = (searchParams.get('storeId') || '').trim() || null

    // Propriété de la conversation + cohérence de boutique ; la permission est
    // ensuite vérifiée sur la boutique de la conversation elle-même, ce qui
    // couvre la révocation d'accès après création de l'historique.
    const thread = await getThread(supabase, threadId, user.id, storeId)
    await assertThreadScopeAccess(supabase, user.id, thread.store_id as string | null)

    const requestedLimit = readPageNumber(searchParams.get('limit'), 100)
    const offsetParam = Number(searchParams.get('offset'))
    const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? Math.trunc(offsetParam) : 0

    // Un message supplémentaire permet de signaler l'existence d'une page plus
    // ancienne sans requête de comptage coûteuse.
    const rows = await listMessages(supabase, threadId, { limit: requestedLimit + 1, offset })
    const hasMore = rows.length > requestedLimit
    const messages = hasMore ? rows.slice(rows.length - requestedLimit) : rows

    return NextResponse.json({ messages, hasMore, limit: requestedLimit, offset })
  } catch (error) {
    const publicError = toPublicError(error)
    return NextResponse.json(
      { error: publicError.code, message: publicError.message },
      { status: publicError.status }
    )
  }
}
