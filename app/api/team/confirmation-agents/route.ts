import { NextResponse } from 'next/server'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { hasPermission, type Role } from '@/lib/auth/permissions'

const AGENT_SELECT =
  'id, store_id, name, commission_per_order, commission_enabled, commission_trigger, use_store_commission_settings, is_active'

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const storeId = String(new URL(request.url).searchParams.get('storeId') || '').trim()

    if (!storeId) {
      return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    }

    const member = await verifyStoreAccess(supabase, user.id, storeId)
    if (!hasPermission(member.role as Role, 'confirmation.settings')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const { data, error } = await supabase
      .from('confirmation_agents')
      .select(AGENT_SELECT)
      .eq('store_id', storeId)
      .order('name', { ascending: true })

    if (error) throw error

    return NextResponse.json({ agents: data || [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CONFIRMATION_AGENTS_FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      storeId?: string
      agentId?: string
      commissionEnabled?: boolean
      commissionAmount?: number
      commissionTrigger?: 'confirmed' | 'delivered'
      useStoreSettings?: boolean
    }

    const storeId = String(body.storeId || '').trim()
    const agentId = String(body.agentId || '').trim()
    if (!storeId || !agentId) {
      return NextResponse.json({ error: 'MISSING_REQUIRED_FIELDS' }, { status: 400 })
    }

    const member = await verifyStoreAccess(supabase, user.id, storeId)
    if (!hasPermission(member.role as Role, 'confirmation.settings')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const commissionAmount = Number(body.commissionAmount ?? 0)
    if (!Number.isFinite(commissionAmount) || commissionAmount < 0) {
      return NextResponse.json({ error: 'INVALID_COMMISSION_AMOUNT' }, { status: 400 })
    }
    const commissionTrigger = body.commissionTrigger === 'confirmed' ? 'confirmed' : 'delivered'

    const { data, error } = await supabase
      .from('confirmation_agents')
      .update({
        commission_enabled: body.commissionEnabled === true,
        commission_per_order: commissionAmount,
        commission_trigger: commissionTrigger,
        use_store_commission_settings: body.useStoreSettings === true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', agentId)
      .eq('store_id', storeId)
      .select(AGENT_SELECT)
      .maybeSingle()

    if (error) throw error
    if (!data) {
      return NextResponse.json({ error: 'AGENT_NOT_FOUND' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, agent: data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CONFIRMATION_AGENT_UPDATE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
