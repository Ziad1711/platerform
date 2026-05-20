import { NextResponse } from 'next/server'
import { assertTrustedOrigin, requireAuthenticatedUser } from '@/lib/assistant/security'
import { listRapidDeliveryShops, resolveRapidDeliveryApiBaseUrl } from '@/lib/integrations/rapid-delivery'
import { createAdminClient } from '@/lib/supabase/admin'
import { listUserStores } from '@/lib/integrations/rapid-delivery-connect'

function toRapidDeliveryErrorMessage(error: unknown) {
  console.error('Rapid Delivery validate error:', error)

  const fallbackMessage = 'RAPID_DELIVERY_VALIDATE_FAILED'
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
      ? error.message
      : fallbackMessage
  const details = typeof error === 'object' && error !== null && 'details' in error && typeof error.details === 'string'
    ? error.details.trim()
    : ''
  const hint = typeof error === 'object' && error !== null && 'hint' in error && typeof error.hint === 'string'
    ? error.hint.trim()
    : ''

  if (message === 'MISSING_INTEGRATIONS_ENCRYPTION_KEY') {
    return 'Configuration serveur manquante: INTEGRATIONS_ENCRYPTION_KEY n’est pas défini.'
  }

  if (message === 'INVALID_INTEGRATIONS_ENCRYPTION_KEY') {
    return 'Configuration serveur invalide: INTEGRATIONS_ENCRYPTION_KEY doit être une clé base64 de 32 octets.'
  }

  if (details || hint) {
    return [message, details, hint].filter(Boolean).join(' | ')
  }

  return message
}

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as { apiToken?: string; endpointType?: string }
    const apiToken = String(body.apiToken || '').trim()
    const baseUrl = resolveRapidDeliveryApiBaseUrl(body.endpointType)

    if (!apiToken) return NextResponse.json({ error: 'MISSING_API_TOKEN' }, { status: 400 })

    const [shops, stores] = await Promise.all([
      listRapidDeliveryShops(apiToken, baseUrl),
      listUserStores(createAdminClient(), user.id),
    ])

    return NextResponse.json({ ok: true, shops, stores })
  } catch (error) {
    const message = toRapidDeliveryErrorMessage(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}