import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser } from '@/lib/assistant/security'
import { listRushlivCities, validateRushlivToken } from '@/lib/integrations/rushliv'
import { listUserStores } from '@/lib/integrations/rushliv-connect'

function toRushlivErrorMessage(error: unknown) {
  console.error('Rushliv validate error:', error)

  const fallbackMessage = 'RUSHLIV_VALIDATE_FAILED'
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
      ? error.message
      : fallbackMessage

  return message || fallbackMessage
}

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as { apiToken?: string }
    const apiToken = String(body.apiToken || '').trim()

    if (!apiToken) return NextResponse.json({ error: 'MISSING_API_TOKEN' }, { status: 400 })

    // Rushliv n'a pas d'endpoint « shops » : le token est validé via
    // `action=track` (les villes, elles, sont publiques).
    const [, cities, stores] = await Promise.all([
      validateRushlivToken(apiToken),
      listRushlivCities(),
      listUserStores(createAdminClient(), user.id),
    ])

    return NextResponse.json({ ok: true, cities, stores, cityCount: cities.length })
  } catch (error) {
    const message = toRushlivErrorMessage(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
