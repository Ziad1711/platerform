import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminError, requireAdmin } from '@/lib/admin/access.server'
import { financeRpc } from '@/lib/admin/finance.server'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams
    const from = day.parse(params.get('from'))
    const until = day.parse(params.get('until'))
    const { context } = await requireAdmin('dashboard.read')
    const data = await financeRpc('rpc_admin_saas_dashboard', { p_from: from, p_until: until }, 'dashboard.read')
    return NextResponse.json({ ...data, permissions: context.permissions }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return adminError(error) }
}
