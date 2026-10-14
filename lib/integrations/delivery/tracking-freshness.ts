// ============================================================
// Fraicheur et couverture du suivi livraison (lecture seule).
//
// Deux niveaux :
//  - overview (leger, table d'etat) : multi-store et badge ;
//  - detail (exact, couverture SQL) : decision de rattrapage, y compris quand
//    AUCUN claim n'existe encore (premier acces, tables vides).
//
// En multi-store, un store en retard n'est jamais masque par la reussite d'un
// autre : chaque store garde son propre verdict.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveStoreIntegration } from './resolve-store-integration'
import { getTrackingProvider, type DeliveryTrackingProvider } from './tracking-providers'
import { EMPTY_COVERAGE, readTrackingCoverage, type TrackingBatchOutcome, type TrackingCoverage } from './tracking-claims'
import { EXCHANGE_ACTIVE_STATUSES } from './exchange-providers'

type AdminClient = SupabaseClient<any, 'public', any>

/** Seuil de fraicheur : au-dela, un rattrapage est demande. */
export const DELIVERY_TRACKING_FRESHNESS_MS = 15 * 60 * 1000

/** Cadence minimale imposee cote serveur (anti-abus), hors action manuelle. */
export const DELIVERY_TRACKING_MIN_INTERVAL_MS = 120_000

/** Cadence minimale pour une resynchronisation manuelle explicite. */
export const DELIVERY_TRACKING_MANUAL_MIN_INTERVAL_MS = 30_000

export type ProviderTrackingState = {
  provider: string
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  lastCompleteAt: string | null
  lastChangedAt: string | null
  outcome: TrackingBatchOutcome | null
  error: string | null
  changed: number
  failed: number
  revision: number
}

export type StoreTrackingFreshness = {
  storeId: string
  providers: ProviderTrackingState[]
  stale: boolean
  lastCompleteAt: string | null
  lastAttemptAt: string | null
  /** Version des changements metier : le frontend invalide quand elle avance. */
  dataVersion: string
}

export type ProviderTrackingDetail = ProviderTrackingState & {
  coverage: TrackingCoverage
  /** true = des colis sont en cours de traitement (bail actif). */
  inProgress: boolean
  /** true = ce transporteur doit etre parcouru (travail en attente ou jamais suivi). */
  needsCatchUp: boolean
}

export type StoreTrackingDetail = {
  storeId: string
  configuredProviders: number
  providers: ProviderTrackingDetail[]
  needsCatchUp: boolean
  totals: TrackingCoverage
  inProgress: boolean
  dataVersion: string
}

function emptyTotals(): TrackingCoverage {
  return { ...EMPTY_COVERAGE }
}

function addCoverage(base: TrackingCoverage, next: TrackingCoverage): TrackingCoverage {
  return {
    eligible: base.eligible + next.eligible,
    excluded: base.excluded + next.excluded,
    fresh: base.fresh + next.fresh,
    stale: base.stale + next.stale,
    untracked: base.untracked + next.untracked,
    active: base.active + next.active,
    unresolved: base.unresolved + next.unresolved,
    backoff: base.backoff + next.backoff,
    blocked: base.blocked + next.blocked,
    ready: base.ready + next.ready,
    remaining: base.remaining + next.remaining,
    neverSynced: base.neverSynced + next.neverSynced,
    oldestPendingSyncedAt: null,
  }
}

function buildDataVersion(providers: Array<{ provider: string; lastChangedAt: string | null; changed: number; revision: number }>) {
  return providers
    .map((provider) => `${provider.provider}:${provider.lastChangedAt || '-'}:${provider.changed}:${provider.revision}`)
    .sort()
    .join('|')
}


/** Vue legere (table d'etat) pour un ensemble de stores. */
export async function readDeliveryTrackingFreshness(
  admin: AdminClient,
  storeIds: string[],
  freshnessMs = DELIVERY_TRACKING_FRESHNESS_MS
): Promise<StoreTrackingFreshness[]> {
  const ids = storeIds.filter(Boolean)
  if (ids.length === 0) return []

  const { data: stateRows, error } = await admin
    .from('delivery_tracking_state')
    .select(
      'store_id, provider, last_attempt_at, last_success_at, last_complete_at, last_changed_at, last_outcome, last_error, changed, failed, revision'
    )
    .in('store_id', ids)

  if (error) throw error

  // Un transporteur CONFIGURE sans aucune ligne d'etat n'a jamais ete suivi :
  // il ne doit pas etre invisible dans l'agregat du store.
  const { data: companies, error: companiesError } = await admin
    .from('delivery_companies')
    .select('store_id, api_provider')
    .in('store_id', ids)
    .not('api_provider', 'is', null)

  if (companiesError) throw companiesError

  const configuredByStore = new Map<string, Set<string>>()
  for (const row of (companies || []) as Array<{ store_id: string; api_provider: string | null }>) {
    const slug = String(row.api_provider || '').trim()
    if (!slug) continue
    const set = configuredByStore.get(row.store_id) || new Set<string>()
    set.add(slug)
    configuredByStore.set(row.store_id, set)
  }

  const threshold = Date.now() - freshnessMs

  return ids.map((storeId) => {
    const rows = ((stateRows || []) as any[]).filter((row) => row.store_id === storeId)
    const providers: ProviderTrackingState[] = rows
      .map((row) => ({
        provider: String(row.provider),
        lastAttemptAt: row.last_attempt_at || null,
        lastSuccessAt: row.last_success_at || null,
        lastCompleteAt: row.last_complete_at || null,
        lastChangedAt: row.last_changed_at || null,
        outcome: (row.last_outcome as TrackingBatchOutcome) || null,
        error: row.last_error || null,
        changed: Number(row.changed || 0),
        failed: Number(row.failed || 0),
        revision: Number(row.revision || 0),
      }))
      .sort((a, b) => a.provider.localeCompare(b.provider))

    const collect = (values: Array<string | null>) =>
      values.filter((value): value is string => Boolean(value)).map((value) => new Date(value).getTime())

    const attemptTimes = collect(providers.map((provider) => provider.lastAttemptAt))
    const completeTimes = collect(providers.map((provider) => provider.lastCompleteAt))

    // Aucun transporteur ne doit masquer un autre : le store est a jour
    // seulement si CHAQUE transporteur connu a reussi dans la fenetre.
    const providerIsStale = (provider: ProviderTrackingState) => {
      const successTime = provider.lastSuccessAt ? new Date(provider.lastSuccessAt).getTime() : 0
      return (
        !successTime ||
        successTime < threshold ||
        provider.outcome === 'failed' ||
        provider.outcome === 'partial'
      )
    }

    // Un transporteur configure mais jamais rapporte (aucune ligne d'etat)
    // rend le store « en retard », comme un fournisseur absent d'un rapport.
    const configured = configuredByStore.get(storeId) || new Set<string>()
    const reported = new Set(providers.map((provider) => provider.provider))
    const hasUnreportedProvider = Array.from(configured).some((slug) => !reported.has(slug))

    return {
      storeId,
      providers,
      // Aucun etat connu = aucun suivi effectue : c'est bien « en retard »,
      // ce qui declenche le premier rattrapage meme tables vides.
      stale: providers.length === 0 || hasUnreportedProvider || providers.some(providerIsStale),
      lastCompleteAt: completeTimes.length > 0 ? new Date(Math.min(...completeTimes)).toISOString() : null,
      lastAttemptAt: attemptTimes.length > 0 ? new Date(Math.max(...attemptTimes)).toISOString() : null,
      dataVersion: buildDataVersion(providers),
    }
  })
}

/**
 * Detail exact d'un store : transporteurs reellement configures + couverture
 * comptee sur les commandes eligibles. Permet de demander un rattrapage des
 * le premier acces, sans dependre de claims prealables.
 */
export async function readStoreTrackingDetail(
  admin: AdminClient,
  storeId: string,
  freshnessMs = DELIVERY_TRACKING_FRESHNESS_MS
): Promise<StoreTrackingDetail> {
  const { data: companies, error: companiesError } = await admin
    .from('delivery_companies')
    .select('id, api_provider')
    .eq('store_id', storeId)
    .not('api_provider', 'is', null)

  if (companiesError) throw companiesError

  const companiesBySlug = new Map<string, string[]>()
  for (const row of (companies || []) as Array<{ id: string; api_provider: string | null }>) {
    const slug = String(row.api_provider || '').trim()
    if (!slug) continue
    companiesBySlug.set(slug, [...(companiesBySlug.get(slug) || []), row.id])
  }

  const { data: stateRows, error: stateError } = await admin
    .from('delivery_tracking_state')
    .select(
      'provider, last_attempt_at, last_success_at, last_complete_at, last_changed_at, last_outcome, last_error, changed, failed, revision'
    )
    .eq('store_id', storeId)

  if (stateError) throw stateError

  const stateByProvider = new Map<string, any>()
  for (const row of (stateRows || []) as any[]) stateByProvider.set(String(row.provider), row)

  const threshold = Date.now() - freshnessMs
  const providers: ProviderTrackingDetail[] = []
  let totals = emptyTotals()

  for (const [slug, companyIds] of companiesBySlug.entries()) {
    const provider: DeliveryTrackingProvider | null = getTrackingProvider(slug)
    if (!provider) continue

    const integration = await resolveStoreIntegration(admin, slug, storeId)
    const connected = Boolean(integration && integration.status === 'connected')

    let coverage: TrackingCoverage = { ...EMPTY_COVERAGE }
    if (connected) {
      coverage = await readTrackingCoverage(admin, {
        storeId,
        provider: slug,
        trackingColumn: provider.trackingColumn,
        deliveryCompanyIds: companyIds,
        excludedStatuses: provider.excludedStatuses,
        exchangeActiveStatuses: EXCHANGE_ACTIVE_STATUSES,
        freshSeconds: Math.round(freshnessMs / 1000),
      })
    }

    totals = addCoverage(totals, coverage)

    const row = stateByProvider.get(slug)
    const lastSuccessAt = (row?.last_success_at as string) || null
    const lastSuccessTime = lastSuccessAt ? new Date(lastSuccessAt).getTime() : 0

    const needsCatchUp =
      connected &&
      (coverage.ready > 0 ||
        // Premier parcours : colis suivis mais jamais synchronises.
        coverage.neverSynced > 0 ||
        !lastSuccessAt ||
        lastSuccessTime < threshold ||
        coverage.blocked > 0 ||
        coverage.unresolved > 0)

    providers.push({
      provider: slug,
      lastAttemptAt: (row?.last_attempt_at as string) || null,
      lastSuccessAt,
      lastCompleteAt: (row?.last_complete_at as string) || null,
      lastChangedAt: (row?.last_changed_at as string) || null,
      outcome: (row?.last_outcome as TrackingBatchOutcome) || null,
      error: (row?.last_error as string) || null,
      changed: Number(row?.changed || 0),
      failed: Number(row?.failed || 0),
      revision: Number(row?.revision || 0),
      coverage,
      inProgress: coverage.active > 0,
      needsCatchUp,
    })
  }

  providers.sort((a, b) => a.provider.localeCompare(b.provider))

  return {
    storeId,
    configuredProviders: providers.length,
    providers,
    needsCatchUp: providers.some((provider) => provider.needsCatchUp),
    totals,
    inProgress: providers.some((provider) => provider.inProgress),
    dataVersion: buildDataVersion(providers),
  }
}

