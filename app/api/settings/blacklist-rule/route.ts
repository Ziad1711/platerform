import { NextResponse } from 'next/server'
import { getAccessibleStoreIds, requireAuthenticatedUser } from '@/lib/assistant/security'

const DEFAULT_STATUSES = ['returned_not_stocked', 'returned_stocked']

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const storeIds = await getAccessibleStoreIds(supabase, user.id)

    if (!storeIds.length) {
      return NextResponse.json({
        rule: {
          store_ids: [],
          is_enabled: true,
          max_status_hits: 3,
          status_filters: DEFAULT_STATUSES,
        },
      })
    }

    const { data, error } = await supabase
      .from('blacklist_rules')
      .select('store_id, is_enabled, max_status_hits, status_filters')
      .in('store_id', storeIds)
      .order('updated_at', { ascending: false })
      .limit(1)

    if (error) throw error

    const rule = data?.[0]

    return NextResponse.json({
      rule: rule || {
        store_ids: storeIds,
        is_enabled: true,
        max_status_hits: 3,
        status_filters: DEFAULT_STATUSES,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'BLACKLIST_RULE_FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      isEnabled?: boolean
      maxStatusHits?: number
      statusFilters?: string[]
    }

    const storeIds = await getAccessibleStoreIds(supabase, user.id)
    const maxStatusHits = Number(body.maxStatusHits || 0)
    const statusFilters = Array.isArray(body.statusFilters)
      ? body.statusFilters.map((value) => String(value || '').trim()).filter(Boolean)
      : DEFAULT_STATUSES

    if (!storeIds.length) return NextResponse.json({ error: 'NO_ACCESSIBLE_STORE' }, { status: 403 })
    if (maxStatusHits <= 0) return NextResponse.json({ error: 'INVALID_MAX_STATUS_HITS' }, { status: 400 })

    const now = new Date().toISOString()
    const payload = storeIds.map((storeId) => ({
      store_id: storeId,
      is_enabled: body.isEnabled !== false,
      max_status_hits: maxStatusHits,
      status_filters: statusFilters,
      updated_at: now,
    }))

    const { error } = await supabase.from('blacklist_rules').upsert(payload, {
      onConflict: 'store_id',
      ignoreDuplicates: false,
    })

    if (error) throw error
    return NextResponse.json({ ok: true, appliedStoreCount: storeIds.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'BLACKLIST_RULE_SAVE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
