import { randomUUID, createHash } from 'node:crypto'
import { z } from 'zod'
import { adminError, assertAdminOrigin, requireAdmin } from '@/lib/admin/access.server'
import { financeRpc } from '@/lib/admin/finance.server'
import { createAdminClient } from '@/lib/supabase/admin'
import { paymentBody } from '@/lib/billing/payments.server'
import { checkedProofMime } from '@/lib/billing/payment-proof.server'

export const runtime = 'nodejs'
const bucket = 'saas-expense-proofs'
type Context = { params: Promise<{ id: string }> }
export async function POST(request: Request, context: Context) {
  let cleanup: (() => Promise<unknown>) | undefined
  try {
    assertAdminOrigin(request)
    await requireAdmin('finance.write')
    const expense = z.string().uuid().parse((await context.params).id)
    const type = request.headers.get('content-type') || ''
    if (!type.startsWith('multipart/form-data;')) throw new Error('ADMIN_INVALID')
    const body = await paymentBody(request, 5 * 1024 * 1024 + 16384)
    const form = await new Response(new Uint8Array(body), { headers: { 'Content-Type': type } }).formData()
    const file = form.get('file')
    if (!(file instanceof File) || [...form.keys()].length !== 1 || file.size === 0 || file.size > 5242880) throw new Error('ADMIN_INVALID')
    const bytes = Buffer.from(await file.arrayBuffer())
    const mime = checkedProofMime(bytes, file.type)
    const id = randomUUID(); const path = `${expense}/${id}`
    const backend = createAdminClient()
    const upload = await backend.storage.from(bucket).upload(path, bytes, { contentType: mime, upsert: false })
    if (upload.error) throw new Error('ADMIN_UNAVAILABLE')
    cleanup = () => backend.storage.from(bucket).remove([path])
    const result = await financeRpc('rpc_admin_finance_proof', { p_expense: expense, p_id: null,
      p_proof: { id, object_path: path, mime_type: mime, size_bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } }, 'finance.write')
    if (result.replayed) await cleanup()
    cleanup = undefined
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { if (cleanup) await cleanup().catch(() => undefined); return adminError(error) }
}
export async function GET(request: Request, context: Context) {
  try {
    const expense = z.string().uuid().parse((await context.params).id)
    const proof = z.string().uuid().parse(new URL(request.url).searchParams.get('proof'))
    const result = await financeRpc('rpc_admin_finance_proof', { p_expense: expense, p_id: proof, p_proof: null })
    const file = await createAdminClient().storage.from(bucket).download(result.object_path)
    if (file.error || !file.data) throw new Error('FINANCE_NOT_FOUND')
    await requireAdmin('finance.read')
    return new Response(file.data, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="justificatif-depense"',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" } })
  } catch (error) { return adminError(error) }
}