import { NextResponse } from 'next/server'
import { createThread, listThreads } from '@/lib/assistant/chat'
import { assertAssistantAccess } from '@/lib/assistant/access'
import {
  assertTrustedOrigin,
  requireAssistantStoreAccess,
  requireAuthenticatedUser,
  toPublicError,
} from '@/lib/assistant/security'

const MAX_TITLE_LENGTH = 120

function readNumericParam(value: string | null) {
  if (value === null || value.trim() === '') return undefined
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : undefined
}

export async function GET(request: Request) {
  try {
    assertTrustedOrigin(request)

    const { supabase, user } = await requireAuthenticatedUser()
    assertAssistantAccess(user.id)

    const { searchParams } = new URL(request.url)
    const storeId = (searchParams.get('storeId') || '').trim() || null

    // Périmètre explicite : la boutique demandée doit être autorisée, sinon la
    // première boutique autorisée est retenue (aucune agrégation implicite).
    // L'assistant reste réservé aux profils financiers `full` : les
    // conversations contiennent coûts, marges et profits.
    const scope = await requireAssistantStoreAccess(supabase, user.id, storeId)

    const threads = await listThreads(supabase, user.id, scope.storeId, {
      limit: readNumericParam(searchParams.get('limit')),
      offset: readNumericParam(searchParams.get('offset')),
    })

    return NextResponse.json({ threads })
  } catch (error) {
    const publicError = toPublicError(error)
    return NextResponse.json(
      { error: publicError.code, message: publicError.message },
      { status: publicError.status }
    )
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)

    const { supabase, user } = await requireAuthenticatedUser()
    assertAssistantAccess(user.id)

    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      throw new Error('INVALID_REQUEST')
    }

    const source = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>
    const storeId = typeof source.storeId === 'string' && source.storeId.trim() ? source.storeId.trim() : null
    const rawTitle = typeof source.title === 'string' ? source.title.trim() : ''
    const title = rawTitle ? rawTitle.slice(0, MAX_TITLE_LENGTH) : 'Nouvelle conversation'

    const scope = await requireAssistantStoreAccess(supabase, user.id, storeId)
    const thread = await createThread(supabase, user.id, scope.storeId, title)

    return NextResponse.json({ thread })
  } catch (error) {
    const publicError = toPublicError(error)
    return NextResponse.json(
      { error: publicError.code, message: publicError.message },
      { status: publicError.status }
    )
  }
}
