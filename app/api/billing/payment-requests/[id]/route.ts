import { z } from 'zod'
import { bankInstructions, paymentAction, paymentContext, paymentError, paymentJson, paymentResponse, requestFields } from '@/lib/billing/payments.server'

type Context = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params
    const { backend, supabase, user } = await paymentContext(request)
    await paymentAction(backend, user.id, id, 'read')
    const [row, proofs, events, bank] = await Promise.all([
      supabase.from('payment_requests').select(requestFields).eq('id', id).single(),
      supabase.from('payment_proofs').select('id,mime_type,size_bytes,created_at').eq('request_id', id).order('created_at'),
      supabase.from('payment_request_events').select('id,event_type,created_at,reason').eq('request_id', id).order('id'),
      bankInstructions(backend),
    ])
    if (row.error || proofs.error || events.error) throw new Error('PAYMENT_READ_FAILED')
    return paymentResponse({ request: row.data, proofs: proofs.data, events: events.data, bank })
  } catch (error) { return paymentError(error) }
}

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params
    const { backend, user } = await paymentContext(request, true)
    const input = z.object({ action: z.enum(['declare', 'cancel']) }).strict().parse(await paymentJson(request))
    await paymentAction(backend, user.id, id, input.action)
    return paymentResponse({ ok: true })
  } catch (error) { return paymentError(error) }
}