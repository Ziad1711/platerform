import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminError, assertAdminOrigin, requireAdmin } from '@/lib/admin/access.server'

export async function GET() {
  try {
    const { supabase } = await requireAdmin('security.read')
    const { data, error } = await supabase.rpc('rpc_saas_admin_security')
    if (error) throw new Error('ADMIN_UNAVAILABLE')
    if (data?.error) throw new Error(data.error)
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return adminError(error) }
}

export async function POST(request: Request) {
  try {
    assertAdminOrigin(request)
    const { supabase } = await requireAdmin('admins.manage')
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('ADMIN_INVALID')
    const reader = request.body?.getReader()
    if (!reader) throw new Error('ADMIN_INVALID')
    let length = 0
    const chunks: Uint8Array[] = []
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 2048) { await reader.cancel(); throw new Error('ADMIN_INVALID') }
      chunks.push(value)
    }
    const input = z.object({
      userId: z.string().uuid(), role: z.enum(['platform_owner', 'security_admin', 'commercial_reader']),
      active: z.boolean(), reason: z.string().trim().min(10).max(300),
    }).strict().safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    if (!input.success) throw new Error('ADMIN_INVALID')
    const { data, error } = await supabase.rpc('rpc_saas_admin_membership', {
      p_target: input.data.userId, p_role: input.data.role, p_active: input.data.active, p_reason: input.data.reason,
    })
    if (error) throw new Error('ADMIN_UNAVAILABLE')
    if (data?.error) throw new Error(data.error)
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return adminError(error) }
}