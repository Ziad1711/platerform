import { NextResponse } from 'next/server'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { hasPermission, type Role } from '@/lib/auth/permissions'
import { getConfirmationErrorStatus } from '@/lib/confirmation/api-errors'
import {
  CONFIRMATION_FILTERS,
  CONFIRMATION_ORDER_SELECT,
  applyQueueFilter,
  applyQueueOrder,
  normalizeQueueFilter,
  normalizeSortOrder,
} from '@/lib/confirmation/queries'
import { CONFIRMATION_SETTINGS_SELECT, normalizeSettings } from '@/lib/confirmation/settings'
import { getBlacklistedPhones, normalizePhoneForBlacklist } from '@/lib/confirmation/blacklist'

const DEFAULT_LIMIT = 40
const MAX_LIMIT = 100

function parseLimit(raw: string | null) {
  const parsed = Number(raw || DEFAULT_LIMIT)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT
  return Math.min(Math.trunc(parsed), MAX_LIMIT)
}

function parseOffset(raw: string | null) {
  const parsed = Number(raw || 0)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Math.trunc(parsed)
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const params = new URL(request.url).searchParams

    const storeId = String(params.get('storeId') || '').trim()
    if (!storeId) {
      return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    }

    const member = await verifyStoreAccess(supabase, user.id, storeId)
    if (!hasPermission(member.role as Role, 'confirmation.view')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    // Périmètre agent : un agent de confirmation ne voit que ses propres commandes.
    let agentScopeId: string | null = null
    if (member.role === 'confirmation') {
      const { data: agent } = await supabase
        .from('confirmation_agents')
        .select('id')
        .eq('store_id', storeId)
        .eq('member_id', member.id)
        .maybeSingle()
      agentScopeId = agent?.id ? String(agent.id) : '00000000-0000-0000-0000-000000000000'
    }

    const filter = normalizeQueueFilter(params.get('filter'))
    const sort = normalizeSortOrder(params.get('sort'), filter)
    const search = String(params.get('search') || '').trim()
    const limit = parseLimit(params.get('limit'))
    const offset = parseOffset(params.get('offset'))
    const nowIso = new Date().toISOString()
    const todayStart = String(params.get('todayStart') || '').trim() || null

    let ordersQuery = supabase.from('orders').select(CONFIRMATION_ORDER_SELECT).eq('store_id', storeId)
    if (agentScopeId) {
      ordersQuery = ordersQuery.eq('confirmation_agent_id', agentScopeId)
    }
    ordersQuery = applyQueueFilter(ordersQuery, filter, nowIso)
    ordersQuery = applyQueueOrder(ordersQuery, filter, sort)
    if (search) {
      ordersQuery = ordersQuery.or(
        `customer_name.ilike.%${search}%,phone.ilike.%${search}%,tracking_number.ilike.%${search}%`
      )
    }

    let confirmedTodayQuery: any = null
    let cancelledTodayQuery: any = null
    if (todayStart) {
      confirmedTodayQuery = supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('store_id', storeId)
        .eq('status', 'confirmed')
        .gte('confirmation_last_action_at', todayStart)
      cancelledTodayQuery = supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('store_id', storeId)
        .in('status', ['cancelled'])
        .gte('confirmation_last_action_at', todayStart)
      if (agentScopeId) {
        confirmedTodayQuery = confirmedTodayQuery.eq('confirmation_agent_id', agentScopeId)
        cancelledTodayQuery = cancelledTodayQuery.eq('confirmation_agent_id', agentScopeId)
      }
    }

    const [ordersResult, settingsResult, countsEntries, confirmedTodayResult, cancelledTodayResult] =
      await Promise.all([
        ordersQuery.range(offset, offset + limit - 1),
        supabase
          .from('confirmation_settings')
          .select(CONFIRMATION_SETTINGS_SELECT)
          .eq('store_id', storeId)
          .maybeSingle(),
        Promise.all(
          CONFIRMATION_FILTERS.map(async (candidate) => {
            let countQuery = supabase
              .from('orders')
              .select('id', { count: 'exact', head: true })
              .eq('store_id', storeId)
            if (agentScopeId) {
              countQuery = countQuery.eq('confirmation_agent_id', agentScopeId)
            }
            countQuery = applyQueueFilter(countQuery, candidate, nowIso)
            if (search) {
              countQuery = countQuery.or(
                `customer_name.ilike.%${search}%,phone.ilike.%${search}%,tracking_number.ilike.%${search}%`
              )
            }
            const { count, error } = await countQuery
            if (error) throw error
            return [candidate, count || 0] as const
          })
        ),
        confirmedTodayQuery || Promise.resolve({ count: 0, error: null } as any),
        cancelledTodayQuery || Promise.resolve({ count: 0, error: null } as any),
      ])

    if (ordersResult.error) throw ordersResult.error
    if (settingsResult.error) throw settingsResult.error

    const orders = ((ordersResult.data || []) as any[]).map((order) => ({ ...order }))

    // Avertissement blacklist : informatif, il ne bloque jamais la confirmation.
    try {
      const blacklistedPhones = await getBlacklistedPhones(
        supabase,
        storeId,
        orders.map((order) => order.phone)
      )
      orders.forEach((order) => {
        const key = normalizePhoneForBlacklist(order.phone)
        order.is_blacklisted = key ? blacklistedPhones.has(key) : false
      })
    } catch (error) {
      console.error('CONFIRMATION_BLACKLIST_CHECK_FAILED', error)
    }

    const countsByFilter = Object.fromEntries(countsEntries) as Record<string, number>

    const counts = {
      ...countsByFilter,
      // Une commande en attente est forcément dans l'une des trois files ci-dessous.
      pendingTotal:
        (countsByFilter.to_process || 0) + (countsByFilter.to_callback || 0) + (countsByFilter.late || 0),
      confirmedToday: confirmedTodayResult?.count || 0,
      cancelledToday: cancelledTodayResult?.count || 0,
    } as Record<string, number>

    return NextResponse.json({
      settings: normalizeSettings(settingsResult.data, storeId),
      orders,
      counts,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CONFIRMATION_QUEUE_FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: getConfirmationErrorStatus(message) })
  }
}
