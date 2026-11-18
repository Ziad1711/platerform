import 'server-only'
import { z } from 'zod'
import { after } from 'next/server'
import { requireAdmin } from './access.server'
import { drainMetaOutbox, metaRuntimeEnabled } from '@/lib/analytics/meta.server'

export async function adminPaymentRpc(name: string, params: object, permission = 'payments.read') {
  const { supabase } = await requireAdmin(permission)
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw new Error('ADMIN_UNAVAILABLE')
  if (data?.error) throw new Error(data.error)
  return data
}

export async function adminPaymentJson(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('ADMIN_INVALID')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('ADMIN_INVALID')
  let size = 0
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 8192) { await reader.cancel(); throw new Error('ADMIN_INVALID') }
    chunks.push(value)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown } catch { throw new Error('ADMIN_INVALID') }
}

export const decisionSchema = z.object({
  action: z.enum(['approve', 'refuse']), key: z.string().uuid(), reason: z.string().trim().min(10).max(300),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  currency: z.literal('MAD').optional(), bankAccount: z.string().trim().min(2).max(80).optional(),
  bankReference: z.string().trim().min(3).max(120).optional(), valueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict()

export async function decideAdminPayment(id: string, input: z.infer<typeof decisionSchema>) {
  const result = await adminPaymentRpc('rpc_admin_payment_decide', {
    p_request: id, p_action: input.action, p_key: input.key, p_reason: input.reason,
    p_amount: input.amountMinor ?? null, p_currency: input.currency ?? null,
    p_bank_account: input.bankAccount ?? null, p_bank_reference: input.bankReference ?? null,
    p_value_date: input.valueDate ?? null,
  }, 'payments.approve')

  // PostgREST has committed the decision. Never put Meta I/O on the response path.
  if (input.action === 'approve' && result?.ok === true && result.replayed === false &&
      result.status === 'validated' && typeof result.subscription_id === 'string' && metaRuntimeEnabled()) {
    try {
      after(async () => {
        try { await drainMetaOutbox(result.subscription_id) }
        catch { console.warn('META_IMMEDIATE_DISPATCH_FAILED') }
      })
    } catch { console.warn('META_IMMEDIATE_DISPATCH_NOT_SCHEDULED') }
  }
  return result
}