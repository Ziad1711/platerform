import { NextResponse } from 'next/server'
import { adminError, assertAdminOrigin } from '@/lib/admin/access.server'
import { financeFilters, financeRpc, financeWriteSchema } from '@/lib/admin/finance.server'
import { adminPaymentJson } from '@/lib/admin/payments.server'

export async function GET(request: Request) {
  try {
    const filters = financeFilters(request)
    const [data, recognition, retention] = await Promise.all([
      financeRpc('rpc_admin_finance_read', { ...filters, p_export: false }),
      financeRpc('rpc_admin_finance_recognition', { p_from: filters.p_from, p_until: filters.p_until, p_currency: filters.p_currency }),
      financeRpc('rpc_admin_document_retention', {}),
    ])
    return NextResponse.json({ ...data, recognition, retention }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return adminError(error) }
}
export async function POST(request: Request) {
  try {
    assertAdminOrigin(request)
    const input = financeWriteSchema.parse(await adminPaymentJson(request))
    const data = await financeRpc('rpc_admin_finance_write', { p_key: input.key, p_action: input.action, p_data: input.data }, 'finance.write')
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return adminError(error) }
}