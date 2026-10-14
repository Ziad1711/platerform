// ============================================================
// Cron : synchronisation du suivi livraison.
//
// Appele par un ordonnanceur serveur (cron Supabase / Vercel) avec
// `Authorization: Bearer <CRON_SECRET>`. Si le secret n'est pas configure,
// la route refuse de s'executer (503) : jamais de traitement non authentifie.
//
// Aucun credential n'est expose : tout reste cote serveur.
// L'execution est bornee (budget de duree) et ne bloque jamais l'interface.
// ============================================================

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runDeliveryTrackingSweep } from '@/lib/integrations/delivery/tracking-runner'
import { getTrackingProviderSlugs } from '@/lib/integrations/delivery/tracking-providers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** Marge sous la limite d'execution : le cron s'arrete proprement. */
const CRON_TOTAL_BUDGET_MS = 45_000
const CRON_BATCH_BUDGET_MS = 8_000
const CRON_BATCH_LIMIT = 20

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET || ''
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET_NOT_CONFIGURED' }, { status: 503 })
  }

  if ((request.headers.get('authorization') || '') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()

    // Seuls les stores ayant une integration transporteur CONNECTEE sont
    // traites : filtrage explicite, jamais de parcours inter-store.
    const { data: integrations, error } = await admin
      .from('integrations')
      .select('store_id')
      .in('provider', getTrackingProviderSlugs())
      .eq('status', 'connected')
      .not('store_id', 'is', null)

    if (error) throw error
    const storeIds = Array.from(
      new Set(((integrations || []) as Array<{ store_id: string | null }>).map((row) => row.store_id).filter(Boolean))
    ) as string[]

    if (storeIds.length === 0) {
      return NextResponse.json({ ok: true, stores: 0, truncated: false, results: [] })
    }

    const { results, truncated } = await runDeliveryTrackingSweep({
      admin,
      storeIds,
      userId: 'system',
      worker: `cron:${crypto.randomUUID()}`,
      limitPerProvider: CRON_BATCH_LIMIT,
      perBatchBudgetMs: CRON_BATCH_BUDGET_MS,
      totalBudgetMs: CRON_TOTAL_BUDGET_MS,
    })

    const summary = results.reduce(
      (totals, result) => ({
        processed: totals.processed + result.processed,
        changed: totals.changed + result.changed,
        skipped: totals.skipped + result.skipped,
        failed: totals.failed + result.failed,
        remaining: totals.remaining + result.coverage.remaining,
        blocked: totals.blocked + result.coverage.blocked,
        unresolved: totals.unresolved + result.coverage.unresolved,
      }),
      { processed: 0, changed: 0, skipped: 0, failed: 0, remaining: 0, blocked: 0, unresolved: 0 }
    )

    const carriersBusy = results.filter((result) => result.reason === 'CARRIER_BUSY').length
    const rateLimited = results.filter((result) => result.reason === 'CARRIER_RATE_LIMITED').length

    return NextResponse.json({
      ok: true,
      stores: storeIds.length,
      truncated,
      carriersBusy,
      rateLimited,
      summary,
      results,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'DELIVERY_TRACKING_CRON_FAILED'
    console.error('[delivery-tracking] cron failed', { error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
