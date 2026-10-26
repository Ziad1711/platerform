// ============================================================
// Claims de suivi livraison : etat en base, couverture, verrous.
//
// Regles :
//  - toute mise a jour de claim est conditionnee au bail detenu (`locked_by`) ;
//  - la couverture est comptee sur les COMMANDES eligibles (pas sur les
//    claims deja crees) : un lot sans travail ne peut pas paraitre complet ;
//  - un motif d'attente (park_reason) distingue une exclusion legitime d'un
//    travail encore a faire ;
//  - toutes les erreurs de lecture/ecriture sont verifiees, jamais avalees.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

type AdminClient = SupabaseClient<any, 'public', any>

export type TrackingBatchOutcome = 'complete' | 'partial' | 'failed' | 'not_configured'

/** Couverture reelle d'un (store, transporteur), calculee en SQL (v2). */
export type TrackingCoverage = {
  eligible: number
  excluded: number
  fresh: number
  stale: number
  untracked: number
  active: number
  unresolved: number
  backoff: number
  blocked: number
  ready: number
  remaining: number
  neverSynced: number
  oldestPendingSyncedAt: string | null
}

export type TrackingBatchResult = {
  storeId: string
  provider: string
  outcome: TrackingBatchOutcome
  processed: number
  changed: number
  skipped: number
  failed: number
  coverage: TrackingCoverage
  reason?: string
  /** Reste a traiter avant ce passage (observabilite de la progression). */
  remainingBefore?: number
}

export type ParkReason = 'manual' | 'terminal' | 'unrecognized' | 'stale'

/** Ligne reclamee par `claim_delivery_tracking_batch` (v4). */
export type ClaimedOrder = {
  order_id: string
  store_id: string
  provider: string
  tracking_key: string
  status: string | null
  delivery_status: string | null
  delivery_status_source: string | null
  exchange_status: string | null
  exchange_original_order_id: string | null
  attempts: number
  park_reason: ParkReason | null
  order_row: Record<string, unknown>
}

export const MAX_TRACKING_ATTEMPTS = 3

/** Backoff des echecs : un colis en erreur ne bloque pas les suivants. */
export const FAILURE_BACKOFF_MS = [60_000, 300_000, 1_800_000]

/**
 * Echecs repetes : le colis est BLOQUE, plus repris automatiquement.
 * Une relance est explicite (voir `park_reason = 'retry_requested'`).
 */
export const PARK_BLOCKED_MS = 365 * 24 * 60 * 60 * 1000

/** Correction manuelle : plus jamais reprise automatiquement. */
export const PARK_MANUAL_MS = 24 * 60 * 60 * 1000

/** Decision terminale : rien a suivre (reverification tres lente). */
export const PARK_TERMINAL_MS = 30 * 24 * 60 * 60 * 1000

/** Mise a jour abandonnee (course) : on retente tres vite. */
export const STALE_RETRY_MS = 60_000

/** Statut transporteur illisible : reste A TRAITER (jamais compte comme fait). */
export const UNRECOGNIZED_RETRY_MS = 6 * 60 * 60 * 1000

export const EMPTY_COVERAGE: TrackingCoverage = {
  eligible: 0,
  excluded: 0,
  fresh: 0,
  stale: 0,
  untracked: 0,
  active: 0,
  unresolved: 0,
  backoff: 0,
  blocked: 0,
  ready: 0,
  remaining: 0,
  neverSynced: 0,
  oldestPendingSyncedAt: null,
}

/**
 * Met a jour l'etat d'une ligne de claim, uniquement si ce worker detient
 * encore le bail. Renvoie false si le bail a ete perdu (aucun ecrasement).
 */
export async function releaseClaim(
  admin: AdminClient,
  orderId: string,
  worker: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  const { data, error } = await admin
    .from('delivery_tracking_claims')
    .update({ ...payload, locked_at: null, locked_by: null, updated_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .eq('locked_by', worker)
    .select('order_id')

  if (error) {
    console.error('[delivery-tracking] claim release failed', { orderId, error: error.message })
    return false
  }
  return Boolean(data && data.length > 0)
}

/** Libere les colis reclames mais non traites (budget epuise) : ils repartent aussitot. */
export async function releaseUntouched(admin: AdminClient, orderIds: string[], worker: string) {
  if (orderIds.length === 0) return
  const { error } = await admin
    .from('delivery_tracking_claims')
    .update({ locked_at: null, locked_by: null, updated_at: new Date().toISOString() })
    .in('order_id', orderIds)
    .eq('locked_by', worker)

  if (error) console.error('[delivery-tracking] untouched release failed', { error: error.message })
}

/** Couverture reelle (comptee en SQL sur les commandes eligibles). */
export async function readTrackingCoverage(
  admin: AdminClient,
  params: {
    storeId: string
    provider: string
    trackingColumn: string
    deliveryCompanyIds: string[]
    excludedStatuses: string[]
    exchangeActiveStatuses: string[]
    freshSeconds?: number
    leaseSeconds?: number
    signal?: AbortSignal
  }
): Promise<TrackingCoverage> {
  const { data, error } = await admin.rpc('delivery_tracking_coverage', {
    p_store_id: params.storeId,
    p_provider: params.provider,
    p_tracking_column: params.trackingColumn,
    p_delivery_company_ids: params.deliveryCompanyIds,
    p_excluded_statuses: params.excludedStatuses,
    p_exchange_active_statuses: params.exchangeActiveStatuses,
    p_fresh_seconds: params.freshSeconds ?? 900,
    p_lease_seconds: params.leaseSeconds ?? 180,
  }).abortSignal(params.signal as never)

  // Une erreur de comptage ne doit JAMAIS devenir "zero restant".
  if (error) throw new Error(`COVERAGE_FAILED:${error.message}`)

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row) return { ...EMPTY_COVERAGE }

  return {
    eligible: Number(row.eligible || 0),
    excluded: Number(row.excluded || 0),
    fresh: Number(row.fresh || 0),
    stale: Number(row.stale || 0),
    untracked: Number(row.untracked || 0),
    active: Number(row.active || 0),
    unresolved: Number(row.unresolved || 0),
    backoff: Number(row.backoff || 0),
    blocked: Number(row.blocked || 0),
    ready: Number(row.ready || 0),
    remaining: Number(row.remaining || 0),
    neverSynced: Number(row.never_synced || 0),
    oldestPendingSyncedAt: (row.oldest_pending_synced_at as string) || null,
  }
}

/**
 * Finalisation atomique : la commande et son claim sont ecrits dans la meme
 * transaction (RPC `finish_delivery_tracking_claim`). Aucun etat intermediaire
 * dangereux : soit tout est applique, soit rien.
 */
export type FinishClaimResult = {
  outcome: 'applied' | 'unchanged' | 'conflict' | 'lease_lost' | 'invalid_association' | 'error'
  statusChanged: boolean
  deliveryChanged: boolean
  detail: string
}

export async function finishTrackingClaim(
  admin: AdminClient,
  params: {
    storeId: string
    provider: string
    orderId: string
    worker: string
    /** Colonne de suivi du transporteur (liste blanche cote SQL). */
    trackingColumn: string
    /** Societes de livraison autorisees pour ce store/transporteur. */
    deliveryCompanyIds: string[]
    expectedTrackingKey: string | null
    expectedUpdatedAt: string | null
    /** true uniquement pour le suivi manuel d'un colis (aucun bail detenu). */
    allowWithoutClaim: boolean
    leaseSeconds: number
    attempts: number
    lastOutcome: 'applied' | 'unchanged' | 'skipped' | 'failed' | null
    parkReason: ParkReason | null
    nextAttemptAt: Date
    lastError: string | null
    markSynced: boolean
    patch: {
      status: string | null
      deliveryStatus: string | null
      statusDateField: string | null
      statusDateValue: string | null
      rawStatus: string
      completeExchange: boolean
    }
  }
): Promise<FinishClaimResult> {
  const { data, error } = await admin.rpc('finish_delivery_tracking_claim', {
    p_store_id: params.storeId,
    p_provider: params.provider,
    p_order_id: params.orderId,
    p_worker: params.worker,
    p_tracking_column: params.trackingColumn,
    p_delivery_company_ids: params.deliveryCompanyIds,
    p_expected_tracking_key: params.expectedTrackingKey,
    p_expected_updated_at: params.expectedUpdatedAt,
    p_allow_without_claim: params.allowWithoutClaim,
    p_lease_seconds: params.leaseSeconds,
    p_attempts: params.attempts,
    p_last_outcome: params.lastOutcome,
    p_park_reason: params.parkReason,
    p_next_attempt_at: params.nextAttemptAt.toISOString(),
    p_last_error: params.lastError,
    p_mark_synced: params.markSynced,
    p_status: params.patch.status,
    p_delivery_status: params.patch.deliveryStatus,
    p_status_date_field: params.patch.statusDateField,
    p_status_date_value: params.patch.statusDateValue,
    p_raw_status: params.patch.rawStatus,
    p_complete_exchange: params.patch.completeExchange,
  })

  if (error) {
    console.error('[delivery-tracking] finish claim failed', { orderId: params.orderId, error: error.message })
    return { outcome: 'error', statusChanged: false, deliveryChanged: false, detail: error.message }
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  return {
    outcome: ((row?.outcome as FinishClaimResult['outcome']) || 'error'),
    statusChanged: row?.status_changed === true,
    deliveryChanged: row?.delivery_changed === true,
    detail: String(row?.detail || ''),
  }
}


/**
 * Ecrit l'etat observable d'un (store, transporteur).
 * `last_success_at` = dernier parcours utile ; `last_complete_at` = dernier
 * parcours COMPLET (plus aucun travail en attente) ; `last_changed_at` sert
 * au frontend pour invalider ses vues uniquement quand des donnees ont bouge.
 */
export async function saveTrackingState(
  admin: AdminClient,
  params: {
    storeId: string
    provider: string
    outcome: TrackingBatchOutcome
    processed: number
    changed: number
    skipped: number
    failed: number
    coverage: TrackingCoverage
    error?: string | null
  }
) {
  const now = new Date().toISOString()
  const payload: Record<string, unknown> = {
    store_id: params.storeId,
    provider: params.provider,
    last_attempt_at: now,
    last_outcome: params.outcome,
    last_error: params.error || null,
    processed: params.processed,
    changed: params.changed,
    skipped: params.skipped,
    failed: params.failed,
    remaining: params.coverage.remaining,
    updated_at: now,
  }

  if (params.outcome === 'complete' || params.outcome === 'partial') payload.last_success_at = now
  if (params.outcome === 'complete') payload.last_complete_at = now
  if (params.changed > 0) payload.last_changed_at = now

  const { error } = await admin.from('delivery_tracking_state').upsert(payload, { onConflict: 'store_id,provider' })
  if (error) console.error('[delivery-tracking] state save failed', { storeId: params.storeId, error: error.message })
}

/**
 * Echec reel (credentials, claim refuse, panne inattendue) : visible, jamais
 * annonce comme a jour. Les cas « transporteur non configure » ne passent pas
 * par ici (ce n'est pas une panne).
 */
export async function recordBatchFailure(
  admin: AdminClient,
  storeId: string,
  provider: string,
  reason: string,
  coverage: TrackingCoverage = EMPTY_COVERAGE
): Promise<TrackingBatchResult> {
  await saveTrackingState(admin, {
    storeId,
    provider,
    outcome: 'failed',
    processed: 0,
    changed: 0,
    skipped: 0,
    failed: 0,
    coverage,
    error: reason,
  })
  return { storeId, provider, outcome: 'failed', processed: 0, changed: 0, skipped: 0, failed: 0, coverage, reason }
}

/** Motif de refus d'une reservation (verifie en une seule transaction SQL). */
export type ReservationReason =
  | 'acquired'
  | 'busy'
  | 'throttled'
  | 'rate_limited'
  | 'configuration_blocked'
  | 'invalid_association'

export type ReservationResult = {
  acquired: boolean
  reason: ReservationReason
  retryAfterSeconds: number | null
}

/**
 * Reservation ATOMIQUE du compte transporteur : bail + delai minimum +
 * cooldown + blocage de configuration sont verifies cote SQL, dans une seule
 * transaction. Aucun contournement possible depuis le client.
 */
export async function reserveTrackingSlot(
  admin: AdminClient,
  params: {
    integrationId: string
    storeId: string
    provider: string
    worker: string
    leaseSeconds: number
    minIntervalSeconds: number
  }
): Promise<ReservationResult> {
  const { data, error } = await admin.rpc('reserve_delivery_tracking_slot', {
    p_integration_id: params.integrationId,
    p_store_id: params.storeId,
    p_provider: params.provider,
    p_worker: params.worker,
    p_lease_seconds: Math.max(30, Math.min(params.leaseSeconds, 1800)),
    p_min_interval_seconds: Math.max(0, Math.min(params.minIntervalSeconds, 3600)),
  })

  if (error) throw new Error(`RESERVE_FAILED:${error.message}`)

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  return {
    acquired: row?.acquired === true,
    reason: ((row?.reason as ReservationReason) || 'busy'),
    retryAfterSeconds: row?.retry_after_seconds ? Number(row.retry_after_seconds) : null,
  }
}

/** Impose un repos au COMPTE (429) ou un blocage de configuration (401/403). */
export async function markTrackingCooldown(
  admin: AdminClient,
  params: { integrationId: string; worker: string | null; cooldownSeconds: number; configurationError?: boolean }
) {
  const { error } = await admin.rpc('mark_delivery_tracking_cooldown', {
    p_integration_id: params.integrationId,
    p_worker: params.worker,
    p_cooldown_seconds: Math.max(30, Math.min(params.cooldownSeconds, 86400)),
    p_configuration_error: params.configurationError === true,
  })

  if (error) console.error('[delivery-tracking] cooldown save failed', {
    integrationId: params.integrationId,
    error: error.message,
  })
}

/** Liberation du bail (uniquement par son detenteur). */
export async function releaseTrackingLock(admin: AdminClient, integrationId: string, worker: string) {
  const { error } = await admin.rpc('release_delivery_tracking_lock', {
    p_integration_id: integrationId,
    p_worker: worker,
  })
  if (error) console.error('[delivery-tracking] lock release failed', { integrationId, error: error.message })
}

