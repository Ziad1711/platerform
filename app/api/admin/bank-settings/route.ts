import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminPaymentJson, adminPaymentRpc } from '@/lib/admin/payments.server'
import { adminError, assertAdminOrigin } from '@/lib/admin/access.server'

export async function GET() {
  try {
    const data = await adminPaymentRpc('rpc_admin_bank_settings', { p_values: null, p_reason: null }, 'bank_settings.manage')
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return adminError(error) }
}
export async function POST(request: Request) {
  try {
    assertAdminOrigin(request)
    const input = z.object({
      action: z.enum(['save_draft', 'publish', 'suspend']),
      beneficiary: z.string().trim().max(200),
      bank_name: z.string().trim().max(200),
      rib: z.string().trim().refine((value) => value === '' || /^\d{24}$/.test(value), 'RIB marocain de 24 chiffres attendu.'),
      instructions: z.string().max(1000),
      commercial_conditions_approved: z.boolean(),
      reason: z.string().trim().min(10).max(300),
    }).strict().parse(await adminPaymentJson(request))
    const { reason, ...values } = input
    const data = await adminPaymentRpc('rpc_admin_bank_settings', {
      p_values: values, p_reason: reason,
    }, 'bank_settings.manage')
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return adminError(error) }
}