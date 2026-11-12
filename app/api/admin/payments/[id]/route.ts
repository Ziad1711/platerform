import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminPaymentJson, adminPaymentRpc, decisionSchema } from '@/lib/admin/payments.server'
import { adminError, assertAdminOrigin, requireAdmin } from '@/lib/admin/access.server'
import { createAdminClient } from '@/lib/supabase/admin'

type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, context: Context) {
  try {
    const id = z.string().uuid().parse((await context.params).id)
    const proof = new URL(request.url).searchParams.get('proof')
    if (proof) {
      z.string().uuid().parse(proof)
      const data = await adminPaymentRpc('rpc_admin_payment_detail', { p_request: id, p_proof: proof })
      const file = await createAdminClient().storage.from('payment-proofs').download(data.object_path)
      if (file.error || !file.data) throw new Error('PAYMENT_NOT_FOUND')
      // Revérifier après la lecture du fichier, avant de transmettre les octets.
      await requireAdmin('payments.read')
      return new Response(file.data, { headers: { 'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="justificatif"', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" } })
    }
    const data = await adminPaymentRpc('rpc_admin_payment_detail', { p_request: id, p_proof: null })
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return adminError(error) }
}
export async function POST(request: Request, context: Context) {
  try {
    assertAdminOrigin(request)
    const id = z.string().uuid().parse((await context.params).id)
    const input = decisionSchema.parse(await adminPaymentJson(request))
    const data = await adminPaymentRpc('rpc_admin_payment_decide', {
      p_request: id, p_action: input.action, p_key: input.key, p_reason: input.reason,
      p_amount: input.amountMinor ?? null, p_currency: input.currency ?? null,
      p_bank_account: input.bankAccount ?? null, p_bank_reference: input.bankReference ?? null,
      p_value_date: input.valueDate ?? null,
    }, 'payments.approve')
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return adminError(error) }
}