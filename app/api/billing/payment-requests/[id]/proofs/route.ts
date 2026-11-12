import { createHash, randomUUID } from 'node:crypto'
import { bankInstructions, paymentAction, paymentBody, paymentContext, paymentError, paymentId, paymentResponse } from '@/lib/billing/payments.server'
import { checkedProofMime } from '@/lib/billing/payment-proof.server'

export const runtime = 'nodejs'
type Context = { params: Promise<{ id: string }> }
const BUCKET = 'payment-proofs'

export async function POST(request: Request, context: Context) {
  let cleanup: (() => Promise<unknown>) | undefined
  try {
    const { id } = await context.params
    const { backend, user } = await paymentContext(request, true)
    const row = await paymentAction(backend, user.id, id, 'read')
    if (!['pending', 'review'].includes(row.status)) throw new Error('PAYMENT_CLOSED')
    const bank = await bankInstructions(backend)
    if (!bank.enabled) throw new Error('PAYMENT_UNAVAILABLE')
    const type = request.headers.get('content-type') || ''
    if (!type.startsWith('multipart/form-data;')) throw new Error('PAYMENT_INVALID')
    const body = await paymentBody(request, 5 * 1024 * 1024 + 16 * 1024)
    const form = await new Response(new Uint8Array(body), { headers: { 'Content-Type': type } }).formData()
    const file = form.get('file')
    if (!(file instanceof File) || [...form.keys()].length !== 1 || file.size === 0) throw new Error('PAYMENT_INVALID')
    if (file.size > 5 * 1024 * 1024) throw new Error('PAYMENT_TOO_LARGE')
    const bytes = Buffer.from(await file.arrayBuffer())
    const mime = checkedProofMime(bytes, file.type)
    const hash = createHash('sha256').update(bytes).digest('hex')
    const { data: duplicate } = await backend.from('payment_proofs').select('id').eq('request_id', id).eq('user_id', user.id).eq('sha256', hash).maybeSingle()
    if (duplicate) return paymentResponse({ ok: true })
    const proofId = randomUUID()
    const path = `${user.id}/${id}/${proofId}`
    const { error } = await backend.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false })
    if (error) throw error
    cleanup = () => backend.storage.from(BUCKET).remove([path])
    await paymentAction(backend, user.id, id, 'proof', { id: proofId, object_path: path, mime_type: mime, size_bytes: bytes.length, sha256: hash })
    cleanup = undefined
    return paymentResponse({ ok: true })
  } catch (error) {
    if (cleanup) await cleanup().catch(() => undefined)
    return paymentError(error)
  }
}

export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params
    paymentId.parse(id)
    const proofId = paymentId.parse(new URL(request.url).searchParams.get('proof'))
    const { supabase, user } = await paymentContext(request)
    const { data, error } = await supabase.from('payment_proofs').select('object_path,mime_type').eq('id', proofId).eq('request_id', id).eq('user_id', user.id).maybeSingle()
    if (error || !data) throw new Error('PAYMENT_NOT_FOUND')
    const download = await supabase.storage.from(BUCKET).download(data.object_path)
    if (download.error || !download.data) throw new Error('PAYMENT_NOT_FOUND')
    return new Response(download.data, { headers: {
      'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="justificatif"',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Cache-Control': 'no-store',
    } })
  } catch (error) { return paymentError(error) }
}