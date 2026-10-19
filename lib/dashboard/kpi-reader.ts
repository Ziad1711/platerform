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

export const KPI_READER_RPC = 'rpc_dashboard_kpi_reader'
export const KPI_READER_DIRECT_LIMIT = 7

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
  ] as const
}

export async function fetchDashboardKpiReader(
  supabase: SupabaseClient,
  input: KpiReaderInput,
): Promise<KpiReaderPayload> {
  const { data, error } = await supabase.rpc(KPI_READER_RPC, {
    p_store_ids: input.storeIds,
    p_from: input.from,
    p_to: input.to,
    p_include_direct: input.includeDirect ?? true,
  })

  if (error) {
    throw new KpiReaderError(toErrorCode(error.message), error.message)
  }

  return data as KpiReaderPayload
}

/** Un accès `full` est seul à exposer les coûts, la marge et le profit. */
export function hasFinancialTotals(
  store: KpiReaderStore,
): store is KpiReaderStore & { access: 'full'; totals: KpiReaderTotalsFull } {
  return store.access === 'full'
}
