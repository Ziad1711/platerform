import 'server-only'
import { z } from 'zod'
import { requireAdmin } from './access.server'

const id = z.string().uuid()
const money = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const currency = z.enum(['MAD', 'EUR', 'USD', 'GBP', 'CAD', 'AED'])
const reason = z.string().trim().min(10).max(500)
const reference = z.string().trim().min(2).max(120)
const expenseFields = {
  categoryId: id, beneficiary: z.string().trim().min(2).max(200), description: z.string().trim().min(2).max(500),
  invoiceReference: reference, amountMinor: money, taxMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), currency, date, reason,
}
export const financeWriteSchema = z.discriminatedUnion('action', [
  z.object({ key: id, action: z.literal('category'), data: z.object({ id: id.optional(), name: z.string().trim().min(2).max(120), active: z.boolean().optional(), reason }).strict() }).strict(),
  z.object({ key: id, action: z.literal('account'), data: z.object({ code: z.string().trim().min(2).max(80), name: z.string().trim().min(2).max(120), currency, reason }).strict() }).strict(),
  z.object({ key: id, action: z.literal('expense'), data: z.object(expenseFields).strict() }).strict(),
  z.object({ key: id, action: z.literal('expense_update'), data: z.object({ ...expenseFields, id, version: z.number().int().positive() }).strict() }).strict(),
  z.object({ key: id, action: z.literal('post'), data: z.object({ id, reason }).strict() }).strict(),
  z.object({ key: id, action: z.literal('cancel'), data: z.object({ id, reason }).strict() }).strict(),
  z.object({ key: id, action: z.literal('credit'), data: z.object({ id, date, reason }).strict() }).strict(),
  z.object({ key: id, action: z.literal('settle'), data: z.object({ id, accountId: id, amountMinor: money, date, reference, reason }).strict() }).strict(),
  z.object({ key: id, action: z.literal('expense_refund'), data: z.object({ id, accountId: id, amountMinor: money, date, reference, reason }).strict() }).strict(),
  z.object({ key: id, action: z.literal('transfer'), data: z.object({ accountId: id, targetAccountId: id, amountMinor: money, date, reference, reason }).strict() }).strict(),
  z.object({ key: id, action: z.literal('movement'), data: z.object({ accountId: id, amountMinor: money, date, reference, reason,
    kind: z.enum(['opening', 'contribution', 'withdrawal', 'payment_refund']), paymentId: id.optional() }).strict() }).strict(),
  z.object({ key: id, action: z.literal('reverse'), data: z.object({ id, date, reference, reason }).strict() }).strict(),
])

export async function financeRpc(name: string, params: object, permission = 'finance.read') {
  const { supabase } = await requireAdmin(permission)
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw new Error('ADMIN_UNAVAILABLE')
  if (data?.error) throw new Error(data.error)
  return data
}

export function financeFilters(request: Request) {
  const params = new URL(request.url).searchParams
  return {
    p_from: date.parse(params.get('from')), p_until: date.parse(params.get('until')),
    p_currency: z.union([currency, z.literal('')]).parse(params.get('currency') || ''),
    p_category: params.get('category') ? id.parse(params.get('category')) : null,
    p_account: params.get('account') ? id.parse(params.get('account')) : null,
    p_status: z.enum(['', 'draft', 'posted', 'cancelled']).parse(params.get('status') || ''),
    p_offset: z.coerce.number().int().min(0).max(100000).parse(params.get('offset') || 0),
  }
}