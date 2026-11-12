export type DashboardCurrencyAmount = { currency: string; receipts_minor?: number; receipt_count?: number; committed_gross_minor?: number }
/**
 * Contrat déterministe du dashboard (rpc_admin_saas_dashboard) :
 * - dates UTC, intervalle [from, until) ; comparaison = même nombre de jours juste avant ;
 * - "customers" = propriétaires distincts de boutiques ; "plans" = forfait effectif par compte ;
 * - période future = aucun droit avant started_at ;
 * - MRR/ARR normalisés disponibles uniquement avec politique approuvée + normalisation validée ;
 * - encaissements = paiements vérifiés à la date de valeur ; charges = date d'engagement ;
 * - aucun accès commandes/produits/clients de boutique ; aucun résultat comptable.
 */
export type SaaSPlanMix = Record<string, number>
export type SaaSReport = {
  from: string; until: string; previous_from: string; days: number
  accounts_created: number; accounts_previous: number
  customers: number; stores: number
  plans: SaaSPlanMix; plans_previous: SaaSPlanMix
  paying_accounts: number; paying_start: number; retention_rate: number | null
  renewals: number; expiring_30d: number
  mrr: { currency: string; mrr_minor: number; arr_minor: number }[] | null
  arr: { currency: string; mrr_minor: number; arr_minor: number }[] | null
  mrr_state: 'available' | 'unavailable'; mrr_reason: string | null
  receipts: DashboardCurrencyAmount[]; expenses_committed: DashboardCurrencyAmount[]
  series: { day: string; accounts: number; paid_starts: number }[]
  series_previous: { day: string; accounts: number }[]
  coverage: Record<string, string>; notes: string[]; permissions: string[]
}
export function dashboardMoney(minor: number, currency: string) {
  return `${(minor / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}
