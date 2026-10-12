import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import { requirePermission } from '@/lib/auth/require-permission'
import {
  buildLightfunnelsAuthorizeUrl,
  createLightfunnelsOAuthState,
  getLightfunnelsConfig,
} from '@/lib/integrations/lightfunnels'

/**
 * Démarre la connexion OAuth Lightfunnels et renvoie l'URL de consentement.
 *
 * L'utilisateur et son droit `integrations.manage` sur le store de départ sont vérifiés
 * avant toute redirection ; le `state` signé ne contient aucun jeton de session.
 */
export async function GET(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser()
    const { searchParams } = new URL(request.url)
    const storeId = (searchParams.get('storeId') || '').trim()

    if (!storeId) {
      return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    }

    await requirePermission(storeId, 'integrations.manage')

    const config = getLightfunnelsConfig()
    if (!config) {
      return NextResponse.json({ error: 'MISSING_LIGHTFUNNELS_CONFIG' }, { status: 500 })
    }

    const state = createLightfunnelsOAuthState(
      {
        userId: user.id,
        storeId,
        ts: Date.now(),
        nonce: randomUUID(),
      },
      config.clientSecret
    )

    const url = buildLightfunnelsAuthorizeUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
    })

    return NextResponse.json({ url })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
    const status = message === 'UNAUTHORIZED' ? 401 : message === 'FORBIDDEN' ? 403 : 500
    console.error('[lightfunnels][connect] failed', { message })
    return NextResponse.json({ error: message }, { status })
  }
}
