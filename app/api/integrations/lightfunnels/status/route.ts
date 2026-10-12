import { NextResponse } from 'next/server'
import { getAccessibleStoreIds, requireAuthenticatedUser } from '@/lib/assistant/security'
import { requirePermission } from '@/lib/auth/require-permission'
import { listLightfunnelsStores } from '@/lib/integrations/lightfunnels'
import {
  getLightfunnelsIntegration,
  listLightfunnelsBindings,
} from '@/lib/integrations/lightfunnels-bindings'
import {
  LIGHTFUNNELS_DEFAULT_SINCE_DATE,
  resolveLightfunnelsAccessToken,
} from '@/lib/integrations/lightfunnels-sync'

/**
 * État de la connexion Lightfunnels pour un store Jisra : installation, boutiques
 * distantes disponibles et liaisons déjà réalisées.
 *
 * Lecture seule (`integrations.view`) ; toute action exige `integrations.manage`.
 */
export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const { searchParams } = new URL(request.url)
    const storeId = (searchParams.get('storeId') || '').trim()

    if (!storeId) {
      return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    }

    await requirePermission(storeId, 'integrations.view')

    const integration = await getLightfunnelsIntegration({ supabase, userId: user.id })

    if (!integration) {
      return NextResponse.json({
        connected: false,
        needsReconnect: false,
        stores: [],
        bindings: [],
        minSinceDate: LIGHTFUNNELS_DEFAULT_SINCE_DATE,
        warnings: [],
      })
    }

    // Seules les liaisons des stores accessibles par l'appelant sont exposées : un membre
    // autorisé sur un store ne doit pas découvrir les autres boutiques du compte.
    const accessibleStoreIds = new Set(await getAccessibleStoreIds(supabase, user.id))

    const bindings = (await listLightfunnelsBindings({ supabase, integrationId: integration.id })).filter(
      (binding) => accessibleStoreIds.has(binding.store_id)
    )

    // `connected` décrit l'installation réelle : une installation déconnectée (jetons
    // effacés, ligne conservée pour ses mappings) doit laisser la reconnexion possible.
    const isConnected = String(integration.status || '') === 'connected'

    const base = {
      connected: isConnected,
      needsReconnect: String(integration.status || '') === 'error',
      integrationId: integration.id as string,
      integrationStatus: integration.status as string,
      bindings,
      minSinceDate: LIGHTFUNNELS_DEFAULT_SINCE_DATE,
    }

    if (!isConnected) {
      return NextResponse.json({ ...base, stores: [], warnings: [] })
    }

    try {
      const { accessToken } = await resolveLightfunnelsAccessToken({
        supabase,
        integrationId: integration.id,
      })

      const stores = await listLightfunnelsStores({ accessToken })

      return NextResponse.json({
        ...base,
        stores: stores.map((store) => ({
          id: String(store.id),
          name: String(store.name || store.slug || store.id),
          slug: store.slug ? String(store.slug) : null,
        })),
        warnings: [],
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'LIGHTFUNNELS_STORES_FAILED'
      console.error('[lightfunnels][status] store listing failed', { message })

      return NextResponse.json({
        ...base,
        needsReconnect: message.includes('TOKEN_EXPIRED') || base.needsReconnect,
        stores: [],
        warnings: [message],
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
    const status = message === 'UNAUTHORIZED' ? 401 : message === 'FORBIDDEN' ? 403 : 500
    console.error('[lightfunnels][status] failed', { message })
    return NextResponse.json({ error: message }, { status })
  }
}
