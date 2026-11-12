import { NextResponse } from 'next/server'
import { adminPaymentRpc } from '@/lib/admin/payments.server'
import { adminError } from '@/lib/admin/access.server'

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams
    const offset = Number(params.get('offset') || 0)
    if (!Number.isInteger(offset)) throw new Error('ADMIN_INVALID')
    const data = await adminPaymentRpc('rpc_admin_payment_list', {
      p_search: params.get('search') || '', p_status: params.get('status') || '', p_offset: offset,
    })
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return adminError(error) }
}