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
import { computeQueueProgress, isQueueStalled } from '@/lib/integrations/delivery/tracking-budget'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Budget total du passage, sous la duree maximale de la fonction.
 * Auparavant 25 s avec 6 s par couple : sur 10 couples connectes et des
 * appels transporteur de 2 a 4 s, seuls 1 ou 2 colis etaient traites alors
 * que 11 attendaient. Le budget ne cree aucun parallelisme : le verrou SQL
 * par transporteur reste la seule voie d'execution.
 */
const CRON_TOTAL_BUDGET_MS = 45_000
const CRON_BATCH_BUDGET_MS = 12_000
const CRON_BATCH_LIMIT = 15

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

    // Cibles = couples (store, transporteur) REELLEMENT connectes. Jamais le
    // produit cartesien stores x transporteurs : il multipliait les lots pour
    // des integrations inexistantes et saturait la base (incident du
    // 24/10/2026 : PostgREST en 503, cache de schema en timeout).
    const { data: integrations, error } = await admin
      .from('integrations')
      .select('store_id, provider')
      .in('provider', getTrackingProviderSlugs())
      .eq('status', 'connected')
      .not('store_id', 'is', null)

    if (error) throw error

    const targets = Array.from(
      new Map(
        ((integrations || []) as Array<{ store_id: string | null; provider: string | null }>)
          .filter((row) => Boolean(row.store_id) && Boolean(row.provider))
          .map((row) => [
            `${row.store_id}::${row.provider}`,
            { storeId: row.store_id as string, provider: row.provider as string },
          ])
      ).values()
    )
    const storeIds = Array.from(new Set(targets.map((target) => target.storeId)))

    if (targets.length === 0) {
      return NextResponse.json({ ok: true, stores: 0, targets: 0, truncated: false, results: [] })
    }

    const { results, truncated } = await runDeliveryTrackingSweep({
      admin,
      storeIds,
      targets,
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
        ready: totals.ready + result.coverage.ready,
        drained: totals.drained + computeQueueProgress(
          result.remainingBefore ?? result.coverage.remaining,
          result.coverage.remaining,
        ),
        stalled: totals.stalled + (
          isQueueStalled({
            remaining: result.coverage.remaining,
            oldestPendingSyncedAt: result.coverage.oldestPendingSyncedAt,
          }) ? 1 : 0
        ),
      }),
      {
        processed: 0, changed: 0, skipped: 0, failed: 0,
        remaining: 0, blocked: 0, unresolved: 0,
        ready: 0, drained: 0, stalled: 0,
      }
    )

    const oldestPending = results
      .map((result) => result.coverage.oldestPendingSyncedAt)
      .filter((value): value is string => Boolean(value))
      .sort()[0] || null
    const oldestPendingSeconds = oldestPending
      ? Math.max(0, Math.round((Date.now() - new Date(oldestPending).getTime()) / 1000))
      : null

    const carriersBusy = results.filter((result) => result.reason === 'CARRIER_BUSY').length
    const rateLimited = results.filter((result) => result.reason === 'CARRIER_RATE_LIMITED').length

    return NextResponse.json({
      ok: true,
      stores: storeIds.length,
      targets: targets.length,
      truncated,
      carriersBusy,
      rateLimited,
      oldestPendingSeconds,
      summary,
      results,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'DELIVERY_TRACKING_CRON_FAILED'
    console.error('[delivery-tracking] cron failed', { error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
