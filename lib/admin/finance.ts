export type CashAccount = { id: string; code: string; name: string; currency: string; balance_minor: number }
export type ExpenseCategory = { id: string; name: string; active: boolean }
export type Expense = {
  id: string; category_id: string; category_name: string; beneficiary: string; description: string; invoice_reference: string
  amount_minor: number; tax_minor: number; paid_minor: number; currency: string; incurred_on: string
  status: 'draft' | 'posted' | 'cancelled'; kind: 'charge' | 'credit'; version: number
  proofs: { id: string; mime_type: string; created_at: string }[]
}
export type CashMovement = { id: string; account_id: string | null; account_name: string | null; currency: string; amount_minor: number; direction: number; kind: string; occurred_on: string; reference: string; reason: string }
export type FinanceReport = {
  recognition: {
    rows: { currency: string; available: boolean; reason: string | null; recognized_revenue_minor: number | null; attributable_charges_minor: number | null; management_result_minor: number | null; method: string }[]
    scope: string; no_policy_reason: string
  }
  retention: { rows: { bucket: string; configured: boolean; retention_months: number | null; orphan_grace_hours: number | null; orphan_objects: number; missing_objects: number; purge_candidates: number | null }[]; rules: string; deletion_enabled: false }
  accounts: CashAccount[]; categories: ExpenseCategory[]; expenses: Expense[]; movements: CashMovement[]
  summary: { currency: string; committed_gross_minor: number; net_cash_flow_minor: number; receipts_minor: number; net_operating_outflow_minor: number; unassigned_receipts: number }[]
  history: { id: number; action: string; outcome: string; reason: string | null; created_at: string }[]
}
export function financeMoney(minor: number, currency: string) {
  return `${(minor / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}