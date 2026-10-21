// ============================================================
// Suivi livraison : etat de fraicheur et rattrapage a la demande.
//
// GET  ?storeId=...  -> detail exact du store (couverture + besoins)
// GET  (sans param)  -> vue legere des stores autorises (multi-store)
// POST { storeId | storeIds, force? } -> rattrapage borne (1 a 3 stores)
//
// Securite : utilisateur authentifie + origine de confiance + appartenance
// ACTIVE au store. Le store est TOUJOURS valide cote serveur : un client ne
// choisit jamais un store arbitraire, ni un credential.
//
// Le delai minimum est un garde-fou serveur ; la protection forte contre les
// executions concurrentes est le bail par compte transporteur (SQL).
// ============================================================

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  assertTrustedOrigin,
  getAccessibleStoreIds,
  getErrorStatus,
  requireAuthenticatedUser,
  verifyStoreAccess,
} from '@/lib/assistant/security'
import { hasPermission, type Role } from '@/lib/auth/permissions'
import { runDeliveryTrackingSweep } from '@/lib/integrations/delivery/tracking-runner'
import {
  DELIVERY_TRACKING_FRESHNESS_MS,
  DELIVERY_TRACKING_MANUAL_MIN_INTERVAL_MS,
  DELIVERY_TRACKING_MIN_INTERVAL_MS,
  readDeliveryTrackingFreshness,
  readStoreTrackingDetail,
} from '@/lib/integrations/delivery/tracking-freshness'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** Budget court : l'interface reste utilisable pendant la synchronisation. */
const USER_SWEEP_BUDGET_MS = 20_000
const USER_BATCH_BUDGET_MS = 7_000
const USER_BATCH_LIMIT = 20
/** Nombre maximal de stores traites par requete (protection du budget). */
const MAX_STORES_PER_REQUEST = 3

const postSchema = z.object({
  storeId: z.string().uuid().optional(),
  storeIds: z.array(z.string().uuid()).max(MAX_STORES_PER_REQUEST).optional(),
  force: z.boolean().optional(),
})

export async function GET(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()

    const requested = String(new URL(request.url).searchParams.get('storeId') || '').trim()
    const accessible = await getAccessibleStoreIds(supabase, user.id)

    if (requested && !accessible.includes(requested)) {
      return NextResponse.json({ error: 'STORE_ACCESS_DENIED' }, { status: 403 })
    }

    const admin = createAdminClient()
    const stores = await readDeliveryTrackingFreshness(admin, accessible)

    // Detail exact uniquement pour le store courant : le rattrapage est fiable
    // meme quand aucun claim n'existe encore (premier acces, tables vides).
    const store = requested ? await readStoreTrackingDetail(admin, requested, DELIVERY_TRACKING_FRESHNESS_MS) : null

    return NextResponse.json({
      ok: true,
      thresholdMs: DELIVERY_TRACKING_FRESHNESS_MS,
      stores,
      store,
      needsCatchUp: store ? store.needsCatchUp : stores.some((entry) => entry.stale),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'DELIVERY_TRACKING_STATUS_FAILED'
    if (getErrorStatus(error) >= 500) console.error('[delivery-tracking] status failed', { error: message })
    return NextResponse.json({ error: message }, { status: getErrorStatus(error) })
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()

    const parsed = postSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY', detail: parsed.error.issues[0]?.message }, { status: 400 })
    }

    const accessible = await getAccessibleStoreIds(supabase, user.id)
    const requestedTargets = parsed.data.storeIds?.length
      ? parsed.data.storeIds
      : parsed.data.storeId
        ? [parsed.data.storeId]
        : []

    if (requestedTargets.length === 0) {
      return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    }
    if (requestedTargets.some((storeId) => !accessible.includes(storeId))) {
      return NextResponse.json({ error: 'STORE_ACCESS_DENIED' }, { status: 403 })
    }

    // P8.2 : le rattrapage ecrit l'etat de suivi des colis (client admin).
    // L'appartenance au magasin ne suffit pas : il faut une permission d'action,
    // verifiee AVANT toute lecture couteuse ou ecriture.
    for (const storeId of requestedTargets) {
      const member = await verifyStoreAccess(supabase, user.id, storeId)
      const allowed =
        hasPermission(member.role as Role, 'delivery.manage') ||
        hasPermission(member.role as Role, 'integrations.manage')
      if (!allowed) {
        return NextResponse.json({ error: 'FORBIDDEN', storeId }, { status: 403 })
      }
    }

    const admin = createAdminClient()
    const force = parsed.data.force === true
    const minIntervalMs = force ? DELIVERY_TRACKING_MANUAL_MIN_INTERVAL_MS : DELIVERY_TRACKING_MIN_INTERVAL_MS

    // Garde-fou serveur : on ne relance pas un store deja parcouru a l'instant.
    const overview = await readDeliveryTrackingFreshness(admin, requestedTargets)
    const throttled = overview.filter((entry) => {
      const lastAttempt = entry.lastAttemptAt ? new Date(entry.lastAttemptAt).getTime() : 0
      if (!lastAttempt) return false
      if (entry.stale) return false
      return Date.now() - lastAttempt < minIntervalMs
    })

    const targets = requestedTargets.filter((storeId) => !throttled.some((entry) => entry.storeId === storeId))
    if (targets.length === 0) {
      return NextResponse.json({
        ok: true,
        skipped: 'throttled',
        retryAfterMs: minIntervalMs,
        stores: overview,
      })
    }

    const worker = `user:${user.id}:${crypto.randomUUID()}`
    const { results, truncated } = await runDeliveryTrackingSweep({
      admin,
      storeIds: targets,
      userId: user.id,
      worker,
      limitPerProvider: USER_BATCH_LIMIT,
      perBatchBudgetMs: USER_BATCH_BUDGET_MS,
      totalBudgetMs: USER_SWEEP_BUDGET_MS,
      minIntervalSeconds: Math.round(minIntervalMs / 1000),
    })

    const changed = results.reduce((total, result) => total + result.changed, 0)
    const failed = results.reduce((total, result) => total + result.failed, 0)
    const pending = results.reduce((total, result) => total + result.coverage.remaining, 0)

    return NextResponse.json({
      ok: true,
      changed,
      failed,
      pending,
      truncated,
      skipped: throttled.length > 0 ? 'some_throttled' : undefined,
      results,
      stores: await readDeliveryTrackingFreshness(admin, targets),
      store: targets.length === 1 ? await readStoreTrackingDetail(admin, targets[0]) : null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'DELIVERY_TRACKING_SYNC_FAILED'
    if (getErrorStatus(error) >= 500) console.error('[delivery-tracking] sync failed', { error: message })
    return NextResponse.json({ error: message }, { status: getErrorStatus(error) })
  }
}

