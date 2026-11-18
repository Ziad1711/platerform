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
      beneficiary: z.string().trim().max(200, 'Le bénéficiaire ne peut pas dépasser 200 caractères.'),
      bank_name: z.string().trim().max(200, 'Le nom de la banque ne peut pas dépasser 200 caractères.'),
      rib: z.string().trim().refine((value) => value === '' || /^\d{24}$/.test(value), 'Le RIB doit contenir exactement 24 chiffres.'),
      instructions: z.string().max(1000, 'Les instructions ne peuvent pas dépasser 1000 caractères.'),
      commercial_conditions_approved: z.boolean(),
      reason: z.string().trim().min(10, 'Le motif doit contenir au moins 10 caractères.').max(300, 'Le motif ne peut pas dépasser 300 caractères.'),
    }).strict().parse(await adminPaymentJson(request))
    const { reason, ...values } = input
    const data = await adminPaymentRpc('rpc_admin_bank_settings', {
      p_values: values, p_reason: reason,
    }, 'bank_settings.manage')
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return adminError(error) }
}