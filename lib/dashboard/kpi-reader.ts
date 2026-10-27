/**
 * Contrat du lecteur Dashboard KPI V5 (RPC `rpc_dashboard_kpi_reader`).
 *
 * Politique d'accès (D1, option C) :
 * - `full`       : owner / admin / accountant → tous les KPI financiers ;
 * - `commercial` : marketer / viewer          → volumes, CA, publicité ;
 * - les autres rôles sont exclus côté base (le RPC lève `KPI_NO_ACCESS`).
 *
 * Règles de lecture :
 * - bornes en JOURS MÉTIER `[from, to[`, résolues dans le fuseau de la boutique ;
 * - aucun zéro inventé : une journée absente est `missing`, jamais 0 ;
 * - fallback direct borné à `KPI_READER_DIRECT_LIMIT` couples (boutique, jour) ;
 * - montants `numeric` transmis en texte décimal exact (aucun arrondi JS).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { mergeReaderPayloads } from './kpi-reader-merge'

export const KPI_READER_RPC = 'rpc_dashboard_kpi_reader'
/**
 * Même contrat que `KPI_READER_RPC`, avec `delivery_fee_cost` par point
 * journalier (axe `order`, accès `full` uniquement). Utilisé par le graphique
 * « Performance du business » ; les autres widgets restent sur le lecteur
 * d'origine.
 */
export const KPI_READER_RPC_V2 = 'rpc_dashboard_kpi_reader_v2'
export const KPI_READER_DIRECT_LIMIT = 7
/** Plage maximale acceptée par `rpc_dashboard_kpi_reader`. */
export const KPI_READER_MAX_RPC_DAYS = 400
/** Budget d'une lecture RPC : au-delà, la requête est annulée et remontée en erreur. */
export const KPI_READER_REQUEST_TIMEOUT_MS = 20_000

export type KpiReaderAccess = 'full' | 'commercial'

/** `direct` = calculé à la source pour une journée absente ou sale (budget borné). */
export type KpiReaderDayState =
  | 'aggregate'
  | 'direct'
  | 'dirty'
  | 'missing'
  | 'incompatible'

export type KpiReaderErrorCode =
  | 'KPI_UNAUTHENTICATED'
  | 'KPI_BAD_RANGE'
  | 'KPI_RANGE_TOO_LARGE'
  | 'KPI_NO_ACCESS'
  | 'KPI_READER_TIMEOUT'
  | 'KPI_READER_FAILED'
  | 'KPI_UNKNOWN'

export interface KpiReaderQualityCommercial {
  orders_without_lines: number
  delivered_without_lines: number
  line_vs_total_mismatch: number
}

export interface KpiReaderQualityFull extends KpiReaderQualityCommercial {
  zero_purchase_with_revenue: number
  data_issues_count: number
}

export interface KpiReaderTotalsCommercial {
  orders_count: number
  delivered_count: number
  cancelled_count: number
  returned_count: number
  refused_count: number
  pending_count: number
  unclassified_count: number
  /** Montants en texte décimal exact. */
  revenue: string
  revenue_estimated: string
  discount_amount: string
  delivery_charge_customer: string
  ads_tracked: string
  ads_fallback: string
  ad_spend_contract: string
  ads_daily_days: number
  aov: string
  delivery_rate: string
  cpl: string
  cpa: string
  roas: string
  quality: KpiReaderQualityCommercial
}

export interface KpiReaderTotalsFull extends KpiReaderTotalsCommercial {
  purchase_cost: string
  delivery_fee_cost: string
  confirmation_cost: string
  contribution_margin: string
  margin_rate: string
  quality: KpiReaderQualityFull
}

export type KpiReaderTotals = KpiReaderTotalsFull | KpiReaderTotalsCommercial

export interface KpiReaderPoint {
  /** Journée métier `YYYY-MM-DD`. */
  date: string
  state: KpiReaderDayState
  /** Journée en cours dans le fuseau de la boutique. */
  partial: boolean
  orders_count: number
  delivered_count: number
  cancelled_count: number
  returned_count: number
  pending_count: number
  unclassified_count: number
  revenue: string
  ads: string
  /** Absent pour un accès `commercial`. */
  purchase_cost?: string
  /**
   * Coût de livraison de la journée (axe `order`). Absent pour un accès
   * `commercial` ou si le coût n'est pas calculable : jamais un faux zéro.
   */
  delivery_fee_cost?: string
  /** Absent pour un accès `commercial`. */
  contribution_margin?: string
}

export interface KpiReaderCoverage {
  days_total: number
  days_aggregate: number
  days_direct: number
  days_dirty: number
  days_missing: number
  days_incompatible: number
  days_partial: number
}

export interface KpiReaderStore {
  store_id: string
  access: KpiReaderAccess
  currency: string
  tz: string
  definition_version: number
  /** Compteur de publication monotone, sérialisé en texte (bigint). */
  revision: string
  last_rebuild_at: string | null
  coverage: KpiReaderCoverage
  /** `true` dès qu'une journée est sale, absente ou incompatible. */
  incomplete: boolean
  totals: KpiReaderTotals
  /** Journées `aggregate` ou `direct` uniquement. */
  points: KpiReaderPoint[]
}

export interface KpiReaderCurrencyTotals {
  orders_count: number
  delivered_count: number
  revenue: string
  ads: string
}

export interface KpiReaderCurrencyGroup {
  currency: string
  totals: KpiReaderCurrencyTotals
}

export interface KpiReaderPayload {
  definition_version: number
  range: { from: string; to: string }
  generated_at: string
  direct_budget: { limit: number; used: number }
  incomplete: boolean
  stores: KpiReaderStore[]
  /** Une entrée par devise : jamais de somme inter-devises. */
  currencies: KpiReaderCurrencyGroup[]
}

export interface KpiReaderInput {
  /** `null` = toutes les boutiques accessibles. */
  storeIds: string[] | null
  /** Journée métier incluse, `YYYY-MM-DD`. */
  from: string
  /** Journée métier exclue, `YYYY-MM-DD`. */
  to: string
  includeDirect?: boolean
  /** RPC à appeler ; `KPI_READER_RPC` par défaut. */
  rpc?: string
  /** Annulation transmise par React Query (changement de filtre, démontage). */
  signal?: AbortSignal
}

export class KpiReaderError extends Error {
  readonly code: KpiReaderErrorCode

  constructor(code: KpiReaderErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'KpiReaderError'
    this.code = code
  }
}

function toErrorCode(message: string): KpiReaderErrorCode {
  const known: KpiReaderErrorCode[] = [
    'KPI_UNAUTHENTICATED',
    'KPI_BAD_RANGE',
    'KPI_RANGE_TOO_LARGE',
    'KPI_NO_ACCESS',
  ]
  const found = known.find((code) => message.includes(code))
  return found ?? 'KPI_UNKNOWN'
}

/**
 * Clé de cache : la frontière d'identité/session doit être fournie par
 * l'appelant (`boundary`), comme pour les autres requêtes privées.
 */
export function dashboardKpiReaderKey(boundary: string, input: KpiReaderInput) {
  const storeIds = input.storeIds ? [...input.storeIds].sort() : 'all'
  return [
    'dashboard-kpi-reader',
    boundary,
    storeIds,
    input.from,
    input.to,
    input.includeDirect ?? true,
    input.rpc ?? KPI_READER_RPC,
  ] as const
}

export async function fetchDashboardKpiReader(
  supabase: SupabaseClient,
  input: KpiReaderInput,
): Promise<KpiReaderPayload> {
  const totalDays = isoDayNumber(input.to) - isoDayNumber(input.from)

  // Le RPC refuse les plages supérieures à 400 jours : une période plus longue
  // est lue par fenêtres disjointes puis recomposée sans double comptage.
  if (totalDays <= KPI_READER_MAX_RPC_DAYS) {
    return fetchDashboardKpiReaderWindow(supabase, input)
  }

  const windows: KpiReaderInput[] = []
  let cursor = input.from
  while (isoDayNumber(cursor) < isoDayNumber(input.to)) {
    const endDay = Math.min(
      isoDayNumber(cursor) + KPI_READER_MAX_RPC_DAYS,
      isoDayNumber(input.to),
    )
    const windowTo = isoFromDayNumber(endDay)
    windows.push({ ...input, from: cursor, to: windowTo })
    cursor = windowTo
  }

  // Les fenêtres sont disjointes : leur lecture simultanée n'affecte aucun
  // total mais évite l'attente cumulative (notamment l'année précédente).
  const payloads = await Promise.all(
    windows.map((window) => fetchDashboardKpiReaderWindow(supabase, window)),
  )
  return mergeReaderPayloads(payloads)
}

function isoDayNumber(value: string): number {
  const [year, month, day] = value.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

function isoFromDayNumber(value: number): string {
  const date = new Date(value * 86_400_000)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}-${day}`
}

async function fetchDashboardKpiReaderWindow(
  supabase: SupabaseClient,
  input: KpiReaderInput,
): Promise<KpiReaderPayload> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), KPI_READER_REQUEST_TIMEOUT_MS)
  const forwardAbort = () => controller.abort()
  if (input.signal) {
    if (input.signal.aborted) controller.abort()
    else input.signal.addEventListener('abort', forwardAbort)
  }

  try {
    const { data, error } = await supabase
      .rpc(input.rpc ?? KPI_READER_RPC, {
        p_store_ids: input.storeIds,
        p_from: input.from,
        p_to: input.to,
        p_include_direct: input.includeDirect ?? true,
      })
      .abortSignal(controller.signal)

    if (error) {
      throw new KpiReaderError(toErrorCode(error.message), error.message)
    }

    return data as KpiReaderPayload
  } catch (error) {
    if (error instanceof KpiReaderError) throw error
    // Annulation (délai dépassé ou changement de filtre) : erreur bornée,
    // jamais un chargement sans fin.
    throw new KpiReaderError(
      controller.signal.aborted ? 'KPI_READER_TIMEOUT' : 'KPI_READER_FAILED',
      error instanceof Error ? error.message : 'KPI_READER_FAILED',
    )
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', forwardAbort)
  }
}

/**
 * Sonde de révision : RPC minimale dédiée (migration B1).
 *
 * Elle renvoie uniquement le compteur de publication par boutique autorisée,
 * avec exactement la même identité (`auth.uid()`), le même périmètre
 * (`dashboard_kpi_access_level`) et le même contrat d'erreur que
 * `rpc_dashboard_kpi_reader` — sans grille journalière, sans agrégat et sans
 * montant. Le compteur reste un texte décimal exact : aucune conversion en
 * `Number`, qui perdrait la précision au-delà de 2^53.
 */
export const KPI_REVISIONS_RPC = 'rpc_dashboard_kpi_revisions'

export interface KpiRevisionRow {
  store_id: string
  /** Compteur de publication `bigint` sérialisé en texte exact. */
  publish_counter: string
}

export interface KpiRevisionsInput {
  /** `null` = toutes les boutiques autorisées. */
  storeIds: string[] | null
  /** Annulation transmise par React Query (changement de périmètre, démontage). */
  signal?: AbortSignal
}

export async function fetchDashboardKpiRevisions(
  supabase: SupabaseClient,
  input: KpiRevisionsInput,
): Promise<KpiRevisionRow[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), KPI_READER_REQUEST_TIMEOUT_MS)
  const forwardAbort = () => controller.abort()
  if (input.signal) {
    if (input.signal.aborted) controller.abort()
    else input.signal.addEventListener('abort', forwardAbort)
  }

  try {
    const { data, error } = await supabase
      .rpc(KPI_REVISIONS_RPC, { p_store_ids: input.storeIds })
      .abortSignal(controller.signal)

    if (error) {
      throw new KpiReaderError(toErrorCode(error.message), error.message)
    }

    return (data ?? []) as unknown as KpiRevisionRow[]
  } catch (error) {
    if (error instanceof KpiReaderError) throw error
    // Annulation (délai dépassé ou changement de périmètre) : erreur bornée,
    // jamais un chargement sans fin.
    throw new KpiReaderError(
      controller.signal.aborted ? 'KPI_READER_TIMEOUT' : 'KPI_READER_FAILED',
      error instanceof Error ? error.message : 'KPI_READER_FAILED',
    )
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', forwardAbort)
  }
}

/** Un accès `full` est seul à exposer les coûts, la marge et le profit. */
export function hasFinancialTotals(
  store: KpiReaderStore,
): store is KpiReaderStore & { access: 'full'; totals: KpiReaderTotalsFull } {
  return store.access === 'full'
}
