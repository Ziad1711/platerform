import { adminError } from '@/lib/admin/access.server'
import { financeFilters, financeRpc } from '@/lib/admin/finance.server'
import type { FinanceReport } from '@/lib/admin/finance'

function cell(value: unknown) {
  const text = String(value ?? '')
  return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`
}
export async function GET(request: Request) {
  try {
    const data = await financeRpc('rpc_admin_finance_read', { ...financeFilters(request), p_export: true }, 'finance.export') as FinanceReport
    const type = new URL(request.url).searchParams.get('type')
    const rows: unknown[][] = type === 'expenses'
      ? [['id', 'date', 'beneficiaire', 'categorie', 'statut', 'type', 'montant_centimes', 'taxe_centimes', 'regle_net_centimes', 'devise'],
        ...data.expenses.map((e) => [e.id, e.incurred_on, e.beneficiary, e.category_name, e.status, e.kind, e.amount_minor, e.tax_minor, e.paid_minor, e.currency])]
      : [['id', 'date', 'compte', 'type', 'sens', 'montant_centimes', 'devise', 'reference'],
        ...data.movements.map((m) => [m.id, m.occurred_on, m.account_name || 'Non affecté', m.kind, m.direction, m.amount_minor, m.currency, m.reference])]
    return new Response('\uFEFF' + rows.map((row) => row.map(cell).join(';')).join('\r\n'), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="jisra-finances.csv"',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    })
  } catch (error) { return adminError(error) }
}