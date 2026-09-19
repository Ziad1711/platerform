import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, getErrorStatus, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { hasPermission, type Role } from '@/lib/auth/permissions'

const ALLOWED_SOURCES = ['ads', 'organic', 'recommendation'] as const
type OrderSource = (typeof ALLOWED_SOURCES)[number]

function normalizeDate(value: unknown) {
  const date = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ''
}

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      storeId?: string
      dateFrom?: string
      dateTo?: string
      newSource?: string
      currentSource?: string
      dryRun?: boolean
    }

    const storeId = String(body.storeId || '').trim()
    const dateFrom = normalizeDate(body.dateFrom)
    const dateTo = normalizeDate(body.dateTo)
    const newSource = String(body.newSource || '').trim().toLowerCase() as OrderSource
    const currentSource = String(body.currentSource || '').trim().toLowerCase()

    if (!storeId || !dateFrom || !dateTo) {
      return NextResponse.json({ error: 'MISSING_BULK_SOURCE_FIELDS' }, { status: 400 })
    }
    if (dateTo < dateFrom) return NextResponse.json({ error: 'INVALID_DATE_RANGE' }, { status: 400 })
    if (!ALLOWED_SOURCES.includes(newSource)) {
      return NextResponse.json({ error: 'INVALID_SOURCE' }, { status: 400 })
    }
    if (currentSource && !ALLOWED_SOURCES.includes(currentSource as OrderSource)) {
      return NextResponse.json({ error: 'INVALID_CURRENT_SOURCE' }, { status: 400 })
    }

    const member = await verifyStoreAccess(supabase, user.id, storeId)
    if (!hasPermission(member.role as Role, 'sales.write')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const admin = createAdminClient()
    const rangeStart = `${dateFrom}T00:00:00.000Z`
    const rangeEnd = `${dateTo}T23:59:59.999Z`

    let selection = admin
      .from('orders')
      .select('id, order_date')
      .eq('store_id', storeId)
      .gte('order_date', rangeStart)
      .lte('order_date', rangeEnd)

    if (currentSource) selection = selection.eq('source', currentSource)

    const { data: rows, error: rowsError } = await selection.limit(20000)
    if (rowsError) throw rowsError

    const orders = (rows || []) as Array<{ id: string; order_date: string }>
    const affectedDays = Array.from(new Set(orders.map((row) => String(row.order_date).slice(0, 10))))

    if (body.dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        ordersToUpdate: orders.length,
        affectedDays: affectedDays.length,
      })
    }

    if (orders.length > 0) {
      let update = admin
        .from('orders')
        .update({ source: newSource })
        .eq('store_id', storeId)
        .gte('order_date', rangeStart)
        .lte('order_date', rangeEnd)

      if (currentSource) update = update.eq('source', currentSource)

      const { error: updateError } = await update
      if (updateError) throw updateError
    }

    for (const day of affectedDays) {
      const { error } = await admin.rpc('allocate_ads_cost_for_day', { p_store_id: storeId, p_day: day })
      if (error) throw error
    }

    return NextResponse.json({
      ok: true,
      updatedOrders: orders.length,
      recalculatedDays: affectedDays.length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'BULK_ORDER_SOURCE_FAILED'
    return NextResponse.json({ error: message }, { status: getErrorStatus(error) })
  }
}
