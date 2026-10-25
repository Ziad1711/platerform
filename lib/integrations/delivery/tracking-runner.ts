// ============================================================
// Execution du suivi livraison (cron ET endpoints utilisateur).
//
// Garanties :
//  - verrou par compte transporteur : une seule execution a la fois, meme
//    entre cron, onglets et requetes (bail recuperable apres crash) ;
//  - filtrage explicite store + transporteur (jamais inter-store) ;
//  - lots bornes, timeout par appel, budget de duree par execution ;
//  - « complet » exige que la couverture reelle soit vide (aucun travail en
//    attente, aucun echec, aucun statut illisible) ;
//  - une reponse transporteur en retard ne peut pas corrompre une commande
//    (ecriture conditionnelle sur la version `updated_at`) ;
//  - un 429 impose un temps de repos au COMPTE transporteur, pas seulement
//    au colis concerne ;
//  - aucune promesse non attendue apres la reponse HTTP.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveStoreIntegration } from './resolve-store-integration'
import { finalizeTrackedStatus } from './apply-tracked-status'
import { getTrackingProvider, getTrackingProviderSlugs, type DeliveryTrackingProvider, type TrackedStatus } from './tracking-providers'
import { CarrierError } from './carrier-error'
import {
  isQueueStalled,
  resolveTargetBudget,
} from './tracking-budget'
import {
  EXCHANGE_ACTIVE_STATUSES,
  EXCHANGE_RETURN_ORDER_STATUS,
  isExchangeFollowUpOrder,
} from './exchange-providers'
import {
  EMPTY_COVERAGE,
  FAILURE_BACKOFF_MS,
  MAX_TRACKING_ATTEMPTS,
  PARK_BLOCKED_MS,
  PARK_TERMINAL_MS,
  markTrackingCooldown,
  readTrackingCoverage,
  recordBatchFailure,
  releaseClaim,
  releaseTrackingLock,
  releaseUntouched,
  reserveTrackingSlot,
  saveTrackingState,
  type ClaimedOrder,
  type ParkReason,
  type ReservationReason,
  type TrackingBatchOutcome,
  type TrackingBatchResult,
  type TrackingCoverage,
} from './tracking-claims'

export type { TrackingBatchOutcome, TrackingBatchResult } from './tracking-claims'

type AdminClient = SupabaseClient<any, 'public', any>

const DEFAULT_LIMIT = 20
const DEFAULT_LEASE_SECONDS = 180
const DEFAULT_BUDGET_MS = 8000
const CALL_TIMEOUT_MS = 6000
/** Marge reservee a la finalisation (liberations, couverture, etat). */
const FINALIZE_MARGIN_MS = 2000
/** Plafond de securite d'un temps de repos demande par un transporteur. */
const MAX_CARRIER_COOLDOWN_MS = 2 * 60 * 60 * 1000
/** 401/403 : configuration a corriger, on ne boucle pas (reprise tres lente). */
const CONFIG_ERROR_PARK_MS = 6 * 60 * 60 * 1000
/** Budget minimal pour demarrer un appel transporteur + sa finalisation. */
const MIN_CALL_BUDGET_MS = 1500

/** Delai maximum d'un appel transporteur : au-dela, l'appel est ABANDONNE et le
 *  reseau reellement annule via l'AbortController. */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string, controller: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new CarrierError({ message: `TIMEOUT:${label}`, code: 'timeout' }))
        }, ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Classification d'une panne transporteur : basee sur `CarrierError` (structure),
 * jamais sur une regex du message.
 */
type CarrierFailure = {
  /** 429 : temps de repos a imposer au compte transporteur. */
  cooldownMs: number | null
  /** 401/403 : configuration a corriger, aucun nouvel essai automatique. */
  configError: boolean
}

function classifyCarrierFailure(error: unknown): CarrierFailure {
  if (error instanceof CarrierError) {
    if (error.code === 'auth') return { cooldownMs: null, configError: true }
    if (error.code === 'rate_limited') {
      const cooldownMs = error.retryAfterSeconds
        ? Math.min(Math.max(error.retryAfterSeconds, 30) * 1000, MAX_CARRIER_COOLDOWN_MS)
        : 300_000
      return { cooldownMs, configError: false }
    }
    // server / timeout / network : backoff persistant (gere par l'appelant).
    return { cooldownMs: null, configError: false }
  }
  // Erreur non structuree : aucun statut modifie, backoff prudent.
  return { cooldownMs: null, configError: false }
}

/** Deplace le bail pour imposer un repos au compte transporteur. */
async function extendCarrierCooldown(
  admin: AdminClient,
  integrationId: string,
  worker: string,
  cooldownMs: number,
  configurationError = false
) {
  await markTrackingCooldown(admin, {
    integrationId,
    worker,
    cooldownSeconds: Math.max(30, Math.round(cooldownMs / 1000)),
    configurationError,
  })
}


type ClaimedOrderOutcome = 'changed' | 'unchanged' | 'skipped' | 'failed' | 'carrier_cooldown' | 'carrier_config_error'

/** Traite un colis reclame : suivi transporteur + application conditionnelle. */
async function processClaimedOrder(params: {
  admin: AdminClient
  storeId: string
  provider: DeliveryTrackingProvider
  order: ClaimedOrder
  tracker: (trackingKey: string, opts?: { signal?: AbortSignal }) => Promise<TrackedStatus>
  worker: string
  freshnessMs: number
  companyIds: string[]
  leaseSeconds: number
  /** Timeout de l'appel, borne par le budget restant du lot. */
  callTimeoutMs: number
}): Promise<{ outcome: ClaimedOrderOutcome; cooldownMs: number | null }> {
  const { admin, storeId, provider, order, tracker, worker, freshnessMs, companyIds, leaseSeconds, callTimeoutMs } = params
  const trackingKey = String(order.tracking_key || '').trim()

  if (!trackingKey) {
    await releaseClaim(admin, order.order_id, worker, {
      park_reason: 'terminal' satisfies ParkReason,
      last_outcome: 'skipped',
      next_attempt_at: new Date(Date.now() + PARK_TERMINAL_MS).toISOString(),
    })
    return { outcome: 'skipped', cooldownMs: null }
  }

  try {
    const controller = new AbortController()
    const tracked = await withTimeout(tracker(trackingKey, { signal: controller.signal }), callTimeoutMs, `${provider.slug}:track`, controller)

    // Une seule ecriture atomique : commande + claim finalises ensemble.
    const result = await finalizeTrackedStatus({
      admin,
      storeId,
      provider: provider.slug,
      // La ligne COMPLETE de la commande : dates metier reelles + version.
      order: { ...(order.order_row || {}), id: order.order_id, status: order.status },
      tracked,
      terminalOrderStatuses: provider.terminalOrderStatuses,
      exchangeReturnStatus: EXCHANGE_RETURN_ORDER_STATUS,
      isExchangeFollowUp: isExchangeFollowUpOrder({
        status: order.status,
        exchange_status: order.exchange_status,
        exchange_original_order_id: order.exchange_original_order_id,
      }),
      guards: provider.guards,
      worker,
      trackingKey,
      freshnessMs,
      trackingColumn: provider.trackingColumn,
      deliveryCompanyIds: companyIds,
      leaseSeconds,
    })

    // Conflit / bail perdu / association invalide : AUCUNE ecriture, le claim
    // a deja ete reprogramme par la RPC. Ce n'est pas un succes.
    if (result.outcome === 'conflict' || result.outcome === 'lease_lost' || result.outcome === 'invalid_association') {
      return { outcome: 'skipped', cooldownMs: null }
    }
    if (result.outcome === 'error') return { outcome: 'failed', cooldownMs: null }

    if (result.parkReason) return { outcome: 'skipped', cooldownMs: null }
    return {
      outcome: result.statusChanged || result.deliveryChanged ? 'changed' : 'unchanged',
      cooldownMs: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failure = classifyCarrierFailure(error)
    const previousAttempts = Number(order.attempts || 0)
    // Une erreur de configuration ne consomme pas les essais de chaque colis :
    // le lot s'arrete (voir l'appelant) et le colis est parque longuement.
    const nextAttempts = failure.configError
      ? MAX_TRACKING_ATTEMPTS
      : Math.min(previousAttempts + 1, MAX_TRACKING_ATTEMPTS)
    const backoffMs =
      FAILURE_BACKOFF_MS[Math.min(nextAttempts - 1, FAILURE_BACKOFF_MS.length - 1)] ?? FAILURE_BACKOFF_MS[0]
    const isBlocked = nextAttempts >= MAX_TRACKING_ATTEMPTS

    await releaseClaim(admin, order.order_id, worker, {
      attempts: nextAttempts,
      last_outcome: 'failed',
      last_error: message.slice(0, 400),
      park_reason: null,
      next_attempt_at: new Date(
        Date.now() + (failure.configError ? CONFIG_ERROR_PARK_MS : isBlocked ? PARK_BLOCKED_MS : backoffMs)
      ).toISOString(),
    })

    console.error('[delivery-tracking] order failed', {
      storeId,
      provider: provider.slug,
      orderId: order.order_id,
      attempts: nextAttempts,
      configError: failure.configError,
      error: message,
    })

    if (failure.configError) return { outcome: 'carrier_config_error', cooldownMs: null }
    if (failure.cooldownMs) return { outcome: 'carrier_cooldown', cooldownMs: failure.cooldownMs }
    return { outcome: 'failed', cooldownMs: null }
  }
}

function decideOutcome(processed: number, failed: number, coverage: TrackingCoverage): TrackingBatchOutcome {
  if (failed > 0 && processed - failed === 0) return 'failed'
  if (failed > 0 || coverage.remaining > 0) return 'partial'
  return 'complete'
}

/**
 * Traite un lot borne pour un (store, transporteur).
 * L'execution se fait dans l'appel courant : aucun travail n'est lance
 * "en arriere-plan" apres la reponse HTTP.
 */
export async function runDeliveryTrackingBatch(params: {
  admin: AdminClient
  storeId: string
  provider: DeliveryTrackingProvider
  userId: string
  worker: string
  limit?: number
  leaseSeconds?: number
  budgetMs?: number
  freshnessMs?: number
  /** Delai minimum entre deux parcours du meme compte (verifie cote SQL). */
  minIntervalSeconds?: number
}): Promise<TrackingBatchResult> {
  const { admin, storeId, provider, userId, worker } = params
  const minIntervalSeconds = Math.max(0, Math.min(params.minIntervalSeconds ?? 120, 3600))
  const limit = Math.max(1, Math.min(params.limit ?? DEFAULT_LIMIT, 50))
  const leaseSeconds = Math.max(30, Math.min(params.leaseSeconds ?? DEFAULT_LEASE_SECONDS, 1800))
  const budgetMs = Math.max(1000, params.budgetMs ?? DEFAULT_BUDGET_MS)
  const freshnessMs = Math.max(60_000, params.freshnessMs ?? 15 * 60 * 1000)
  const startedAt = Date.now()

  const integration = await resolveStoreIntegration(admin, provider.slug, storeId)
  if (!integration || integration.status !== 'connected') {
    // Transporteur non configure pour ce store : ce n'est pas une panne.
    return {
      storeId,
      provider: provider.slug,
      outcome: 'not_configured',
      processed: 0,
      changed: 0,
      skipped: 0,
      failed: 0,
      coverage: { ...EMPTY_COVERAGE },
      reason: 'INTEGRATION_NOT_CONNECTED',
    }
  }

  const { data: companies, error: companiesError } = await admin
    .from('delivery_companies')
    .select('id')
    .eq('store_id', storeId)
    .eq('api_provider', provider.slug)

  if (companiesError) throw companiesError
  const companyIds = ((companies || []) as Array<{ id: string }>).map((company) => company.id).filter(Boolean)
  if (companyIds.length === 0) {
    return {
      storeId,
      provider: provider.slug,
      outcome: 'not_configured',
      processed: 0,
      changed: 0,
      skipped: 0,
      failed: 0,
      coverage: { ...EMPTY_COVERAGE },
      reason: 'NO_DELIVERY_COMPANY',
    }
  }

  const coverageParams = {
    storeId,
    provider: provider.slug,
    trackingColumn: provider.trackingColumn,
    deliveryCompanyIds: companyIds,
    excludedStatuses: provider.excludedStatuses,
    exchangeActiveStatuses: EXCHANGE_ACTIVE_STATUSES,
    freshSeconds: Math.round(freshnessMs / 1000),
    leaseSeconds,
  }

  // Reservation ATOMIQUE (bail + delai minimum + cooldown + blocage) : tout est
  // verifie cote SQL, aucun contournement possible depuis le client.
  const reservation = await reserveTrackingSlot(admin, {
    integrationId: integration.id,
    storeId,
    provider: provider.slug,
    worker,
    leaseSeconds,
    minIntervalSeconds,
  })

  if (!reservation.acquired) {
    const coverage = await readTrackingCoverage(admin, coverageParams)
    const reasonByReservation: Record<ReservationReason, string> = {
      acquired: 'ACQUIRED',
      busy: 'CARRIER_BUSY',
      throttled: 'THROTTLED',
      rate_limited: 'CARRIER_RATE_LIMITED',
      configuration_blocked: 'CARRIER_CONFIG_ERROR',
      invalid_association: 'INVALID_ASSOCIATION',
    }
    // Un refus n'est jamais « a jour » : configuration cassee, rate-limit ou
    // bail concurrent rendent le lot non complet, meme si la couverture locale
    // est vide. Seul un simple delai minimum (deja parcouru a l'instant) peut
    // etre considere complet quand il ne reste rien a suivre.
    const outcome: TrackingBatchOutcome =
      reservation.reason === 'configuration_blocked' || reservation.reason === 'invalid_association'
        ? 'failed'
        : reservation.reason === 'throttled' && coverage.remaining === 0
          ? 'complete'
          : 'partial'
    return {
      storeId,
      provider: provider.slug,
      outcome,
      processed: 0,
      changed: 0,
      skipped: 0,
      failed: 0,
      coverage,
      reason: reasonByReservation[reservation.reason],
    }
  }


  let tracker
  let cooldownMs: number | null = null
  try {
    tracker = await provider.loadTracker({ admin, storeId, integrationId: integration.id, userId })
  } catch (error) {
    const coverage = await readTrackingCoverage(admin, coverageParams).catch(() => ({ ...EMPTY_COVERAGE }))
    await releaseTrackingLock(admin, integration.id, worker)
    return recordBatchFailure(
      admin,
      storeId,
      provider.slug,
      `CREDENTIALS_ERROR:${error instanceof Error ? error.message : 'unknown'}`,
      coverage
    )
  }

  let processed = 0
  let changed = 0
  let skipped = 0
  let failed = 0
  let configError = false
  let coverage: TrackingCoverage = { ...EMPTY_COVERAGE }

  const deadline = startedAt + budgetMs - FINALIZE_MARGIN_MS
  let stopRequested = false

  try {
    // Plusieurs vagues successives dans le MEME budget : chaque vague ne
    // reclame que les colis qu'elle peut reellement interroger. Un colis
    // reclame est donc toujours suivi d'un appel transporteur, jamais
    // abandonne apres coup. C'est ce qui evite qu'un colis reste des heures
    // sans etre relu alors que des passages ont bien eu lieu.
    while (!stopRequested && processed < limit) {
      const claimLimit = Math.min(
        limit - processed,
        Math.floor((deadline - Date.now()) / MIN_CALL_BUDGET_MS)
      )
      // Budget insuffisant pour un appel ET sa finalisation : on n'ouvre pas
      // de vague (un appel tronque serait pire qu'un report au passage suivant).
      if (claimLimit < 1) break

      const { data: claimed, error: claimError } = await admin.rpc('claim_delivery_tracking_batch', {
        p_store_id: storeId,
        p_provider: provider.slug,
        p_tracking_column: provider.trackingColumn,
        p_delivery_company_ids: companyIds,
        p_excluded_statuses: provider.excludedStatuses,
        p_exchange_active_statuses: EXCHANGE_ACTIVE_STATUSES,
        p_limit: claimLimit,
        p_lease_seconds: leaseSeconds,
        p_worker: worker,
      })

      if (claimError) throw new Error(`CLAIM_FAILED:${claimError.message}`)

      const orders = (claimed || []) as ClaimedOrder[]
      const untouched: string[] = []

      for (let index = 0; index < orders.length; index += 1) {
        const remainingBudget = deadline - Date.now()
        // Budget insuffisant pour un appel ET sa finalisation : on ne commence
        // pas (un appel tronque serait pire qu'un report au lot suivant).
        if (remainingBudget < MIN_CALL_BUDGET_MS) {
          untouched.push(...orders.slice(index).map((rest) => rest.order_id))
          break
        }

        processed += 1
        const result = await processClaimedOrder({
          admin,
          storeId,
          provider,
          order: orders[index],
          tracker,
          worker,
          freshnessMs,
          companyIds,
          leaseSeconds,
          // La marge de finalisation est DEJA retiree de `deadline` : on ne la
          // retire pas une seconde fois, sinon le timeout mange la marge.
          callTimeoutMs: Math.max(MIN_CALL_BUDGET_MS, Math.min(CALL_TIMEOUT_MS, remainingBudget)),
        })

        if (result.outcome === 'changed') changed += 1
        else if (
          result.outcome === 'failed' ||
          result.outcome === 'carrier_cooldown' ||
          result.outcome === 'carrier_config_error'
        ) {
          failed += 1
        } else if (result.outcome === 'skipped') skipped += 1

        if (result.cooldownMs) {
          // Repos impose au COMPTE transporteur : le reste du lot est libere.
          cooldownMs = result.cooldownMs
          await extendCarrierCooldown(admin, integration.id, worker, result.cooldownMs)
          untouched.push(...orders.slice(index + 1).map((rest) => rest.order_id))
          stopRequested = true
          break
        }

        if (result.outcome === 'carrier_config_error') {
          // 401/403 : le compte est BLOQUE (pas seulement mis au repos).
          configError = true
          cooldownMs = CONFIG_ERROR_PARK_MS
          await extendCarrierCooldown(admin, integration.id, worker, CONFIG_ERROR_PARK_MS, true)
          untouched.push(...orders.slice(index + 1).map((rest) => rest.order_id))
          stopRequested = true
          break
        }
      }

      await releaseUntouched(admin, untouched, worker)

      // File vide (moins de colis disponibles que demande) : aucune vague de
      // plus n'apporterait de travail.
      if (orders.length < claimLimit) break
    }

    coverage = await readTrackingCoverage(admin, coverageParams)
  } finally {
    // Le bail est toujours rendu : le repos transporteur et le delai minimum
    // vivent dans des colonnes distinctes, ils ne dependent pas du bail.
    await releaseTrackingLock(admin, integration.id, worker)
  }

  const outcome = decideOutcome(processed, failed, coverage)
  // Une file qui ne progresse plus doit etre visible dans l'interface
  // existante (`delivery_tracking_state.last_error`), sans nouveau service.
  const stalled = isQueueStalled({
    remaining: coverage.remaining,
    oldestPendingSyncedAt: coverage.oldestPendingSyncedAt,
  })
  await saveTrackingState(admin, {
    storeId,
    provider: provider.slug,
    outcome,
    processed,
    changed,
    skipped,
    failed,
    coverage,
    error: configError
      ? 'configuration transporteur a corriger (401/403)'
      : stalled
        ? `file de suivi bloquee : ${coverage.remaining} colis en attente depuis plus de 30 minutes`
        : failed > 0
          ? `${failed} colis en erreur`
          : null,
  })

  return {
    storeId,
    provider: provider.slug,
    outcome,
    processed,
    changed,
    skipped,
    failed,
    coverage,
    reason: configError
      ? 'CARRIER_CONFIG_ERROR'
      : cooldownMs
        ? 'CARRIER_RATE_LIMITED'
        : undefined,
  }
}


/**
 * Parcours groupe : lots bornes sur plusieurs (store, transporteur).
 *
 * Les cibles sont triees par anciennete de tentative (les plus anciennes
 * d'abord) : une meme cible ne peut donc pas affamer les autres, et l'ordre
 * est stable d'une execution a l'autre.
 */
export async function runDeliveryTrackingSweep(params: {
  admin: AdminClient
  storeIds: string[]
  userId: string
  worker: string
  providers?: string[]
  /**
   * Couples (store, transporteur) reellement connectes. Fourni par le cron :
   * sans cela, le parcours fabrique le PRODUIT CARTESIEN des stores et des
   * transporteurs (32 cibles pour 4 stores) et sature la base pour des
   * integrations inexistantes.
   */
  targets?: Array<{ storeId: string; provider: string }>
  limitPerProvider?: number
  totalBudgetMs?: number
  perBatchBudgetMs?: number
  freshnessMs?: number
  minIntervalSeconds?: number
}): Promise<{ results: TrackingBatchResult[]; truncated: boolean }> {
  const { admin, storeIds, userId, worker } = params
  const totalBudgetMs = Math.max(2000, params.totalBudgetMs ?? 45_000)
  const startedAt = Date.now()
  const providers = (params.providers || getTrackingProviderSlugs())
    .map((slug) => getTrackingProvider(slug))
    .filter((provider): provider is DeliveryTrackingProvider => Boolean(provider))

  const results: TrackingBatchResult[] = []
  let truncated = false

  // Etat par (store, transporteur) : sert a prioriser les cibles en retard et
  // a mesurer la progression reelle depuis le passage precedent.
  const { data: stateRows, error: stateError } = await admin
    .from('delivery_tracking_state')
    .select('store_id, provider, last_attempt_at, last_outcome, remaining')
    .in('store_id', storeIds)

  if (stateError) throw stateError

  const lastAttemptByTarget = new Map<string, string>()
  const remainingBeforeByTarget = new Map<string, number>()
  for (const row of (stateRows || []) as Array<{
    store_id: string
    provider: string
    last_attempt_at: string | null
    remaining: number | null
  }>) {
    const key = `${row.store_id}::${row.provider}`
    if (row.last_attempt_at) lastAttemptByTarget.set(key, row.last_attempt_at)
    if (typeof row.remaining === 'number') remainingBeforeByTarget.set(key, row.remaining)
  }

  const explicit = Array.isArray(params.targets) ? params.targets : []
  const pairs: Array<{ storeId: string; provider: DeliveryTrackingProvider }> = explicit.length > 0
    ? explicit
        .map((target) => {
          const provider = getTrackingProvider(String(target.provider || ''))
          return provider ? { storeId: target.storeId, provider } : null
        })
        .filter((target): target is { storeId: string; provider: DeliveryTrackingProvider } => target !== null)
    : storeIds.flatMap((storeId) => providers.map((provider) => ({ storeId, provider })))

  const targets = pairs.sort((a, b) => {
      const aAttempt = lastAttemptByTarget.get(`${a.storeId}::${a.provider.slug}`)
      const bAttempt = lastAttemptByTarget.get(`${b.storeId}::${b.provider.slug}`)
      if (aAttempt === bAttempt) return 0
      if (!aAttempt) return -1
      if (!bAttempt) return 1
      return new Date(aAttempt).getTime() - new Date(bAttempt).getTime()
    })

  for (const target of targets) {
    // Budget borne par le temps total restant : un couple ne peut pas
    // consommer un budget qui n'existe plus. Zero = report au passage suivant.
    const budgetMs = resolveTargetBudget({
      totalBudgetMs,
      elapsedMs: Date.now() - startedAt,
      preferredBudgetMs: params.perBatchBudgetMs,
    })
    if (budgetMs <= 0) {
      truncated = true
      break
    }

    try {
      const result = await runDeliveryTrackingBatch({
        admin,
        storeId: target.storeId,
        provider: target.provider,
        userId,
        worker,
        limit: params.limitPerProvider,
        budgetMs,
        freshnessMs: params.freshnessMs,
        minIntervalSeconds: params.minIntervalSeconds,
      })
      results.push({
        ...result,
        remainingBefore: remainingBeforeByTarget.get(`${target.storeId}::${target.provider.slug}`),
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'TRACKING_BATCH_FAILED'
      // Une panne transporteur reste visible et ne bloque pas les autres.
      console.error('[delivery-tracking] batch failed', {
        storeId: target.storeId,
        provider: target.provider.slug,
        error: reason,
      })
      results.push(await recordBatchFailure(admin, target.storeId, target.provider.slug, reason.slice(0, 300)))
    }
  }

  return { results, truncated }
}

