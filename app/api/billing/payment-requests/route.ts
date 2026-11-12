import { z } from 'zod'
import { paymentContext, paymentError, paymentId, paymentJson, paymentResponse, requestFields } from '@/lib/billing/payments.server'

export async function GET(request: Request) {
  try {
    const { supabase, user } = await paymentContext(request)
    const { data, error } = await supabase.from('payment_requests').select(requestFields).eq('user_id', user.id).order('created_at', { ascending: false }).limit(50)
    if (error) throw error
    return paymentResponse({ requests: data.map((row) => ({ ...row,
      status: row.status === 'pending' && new Date(row.expires_at).getTime() <= Date.now() ? 'expired' : row.status,
    })) })
  } catch (error) { return paymentError(error) }
}

export async function POST(request: Request) {
  try {
    const { backend, user } = await paymentContext(request, true)
    const input = z.object({ priceId: paymentId, idempotencyKey: paymentId }).strict().parse(await paymentJson(request))
    const { data, error } = await backend.rpc('rpc_payment_create', {
      p_user: user.id, p_price: input.priceId, p_key: input.idempotencyKey,
    })
    if (error) throw new Error(error.message)
    return paymentResponse({ id: data.id })
  } catch (error) { return paymentError(error) }
}