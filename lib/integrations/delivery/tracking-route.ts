// ============================================================
// Handler partage des endpoints de resynchronisation par transporteur.
//
// Les quatre points d'entree historiques (rapid-delivery, maroc-go-delivery,
// rushliv, ozone) deleguaient chacun leur propre boucle de mise a jour, avec
// leur propre resolution d'integration et sans verrou. Ils passent tous par le
// service de suivi partage : un seul jeu de regles, un seul verrou, un seul
// mecanisme (identique au cron et au rattrapage du dashboard).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, getErrorStatus, requireAuthenticatedUser } from '@/lib/assistant/security'
import { runDeliveryTrackingBatch } from './tracking-runner'
import { getTrackingProvider } from './tracking-providers'

/** Budget court : une requete utilisateur ne doit pas monopoliser l'execution. */
const ROUTE_BUDGET_MS = 20_000

export async function runProviderTrackingSync(
  request: NextRequest,
  params: { providerSlug: string; fallbackError: string }
) {
  try {
    // Memes controles que les autres endpoints utilisateur.
    assertTrustedOrigin(request)
    const { user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      storeId?: string
      store_id?: string
      limit?: number
    }
    const storeId = String(
      body.storeId || body.store_id || request.cookies.get('current-store-id')?.value || ''
    ).trim()

    if (!storeId) return NextResponse.json({ error: 'STORE_REQUIRED' }, { status: 400 })

    const admin = createAdminClient()

    // Appartenance ACTIVE verifiee avec le client service-role : le filtrage
    // par store est donc explicite, jamais implicitement couvert par la RLS.
    const { data: membership, error: membershipError } = await admin
      .from('store_members')
      .select('store_id')
      .eq('user_id', user.id)
      .eq('store_id', storeId)
      .eq('status', 'active')
      .maybeSingle()

    if (membershipError) throw membershipError
    if (!membership) return NextResponse.json({ error: 'STORE_ACCESS_DENIED' }, { status: 403 })

    const provider = getTrackingProvider(params.providerSlug)
    if (!provider) return NextResponse.json({ error: 'PROVIDER_NOT_SUPPORTED' }, { status: 400 })

    const result = await runDeliveryTrackingBatch({
      admin,
      storeId,
      provider,
      userId: user.id,
      worker: `user:${user.id}:${crypto.randomUUID()}`,
      limit: Number(body.limit) || undefined,
      budgetMs: ROUTE_BUDGET_MS,
    })

    // `synced`/`errors` conserves pour les appelants historiques ; `outcome`,
    // `coverage` et `reason` disent explicitement si le lot est complet,
    // partiel, non configure ou en echec (jamais un faux succes).
    if (result.outcome === 'not_configured') {
      return NextResponse.json(
        { error: params.fallbackError, reason: result.reason, outcome: result.outcome },
        { status: 400 }
      )
    }

    return NextResponse.json({ ...result, synced: result.processed, errors: result.failed })
  } catch (error) {
    const message = error instanceof Error ? error.message : params.fallbackError
    return NextResponse.json({ error: message }, { status: getErrorStatus(error) })
  }
}
