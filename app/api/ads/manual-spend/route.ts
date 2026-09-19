import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, getErrorStatus, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { getCasablancaDateKey } from '@/lib/integrations/facebook-ads-sync'
import { hasPermission, type Role } from '@/lib/auth/permissions'

const MANUAL_ACCOUNT_ID = '__manual__'
const MANUAL_CAMPAIGN_ID = 'daily_manual'
const MANUAL_CAMPAIGN_NAME = 'Dépense manuelle quotidienne'

function normalizeDate(value: unknown) {
  const date = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ''
}

async function recalculateDay(admin: ReturnType<typeof createAdminClient>, storeId: string, spendDate: string) {
  const { count, error: countError } = await admin
    .from('ad_spend_daily')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .gte('spend_date', `${spendDate}T00:00:00.000Z`)
    .lte('spend_date', `${spendDate}T23:59:59.999Z`)

  if (countError) throw countError
  if ((count || 0) > 0) {
    const { error } = await admin.rpc('allocate_ads_cost_for_day', { p_store_id: storeId, p_day: spendDate })
    if (error) throw error
    return
  }

  const { error } = await admin
    .from('orders')
    .update({ ads_cost_allocated: 0 })
    .eq('store_id', storeId)
    .eq('source', 'ads')
    .gte('order_date', `${spendDate}T00:00:00.000Z`)
    .lte('order_date', `${spendDate}T23:59:59.999Z`)

  if (error) throw error
}

async function getStoreCurrency(admin: ReturnType<typeof createAdminClient>, storeId: string) {
  const { data, error } = await admin.from('stores').select('currency').eq('id', storeId).single()
  if (error) throw error
  return String(data.currency || 'MAD').toUpperCase()
}

async function assertNoAutomaticSpend(admin: ReturnType<typeof createAdminClient>, storeId: string, spendDate: string) {
  const { data, error } = await admin
    .from('ad_spend_daily')
    .select('id, external_account_id')
    .eq('store_id', storeId)
    .eq('platform', 'facebook')
    .gte('spend_date', `${spendDate}T00:00:00.000Z`)
    .lte('spend_date', `${spendDate}T23:59:59.999Z`)

  if (error) throw error
  if ((data || []).some((row) => String(row.external_account_id || '') !== MANUAL_ACCOUNT_ID)) {
    throw new Error('AUTOMATIC_SPEND_EXISTS')
  }
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const params = new URL(request.url).searchParams
    const storeId = String(params.get('storeId') || '').trim()
    const from = normalizeDate(params.get('from'))
    const to = normalizeDate(params.get('to'))
    if (!storeId) return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    const member = await verifyStoreAccess(supabase, user.id, storeId)
    if (!hasPermission(member.role as Role, 'advertising.view')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const admin = createAdminClient()
    let query = admin
      .from('ad_spend_daily')
      .select('id, spend_date, spend, spend_converted, spend_currency, currency_convert, created_at')
      .eq('store_id', storeId)
      .eq('platform', 'facebook')
      .eq('external_account_id', MANUAL_ACCOUNT_ID)
      .eq('external_campaign_id', MANUAL_CAMPAIGN_ID)
      .order('spend_date', { ascending: false })

    if (from) query = query.gte('spend_date', `${from}T00:00:00.000Z`)
    if (to) query = query.lte('spend_date', `${to}T23:59:59.999Z`)
    const { data, error } = await query.limit(366)
    if (error) throw error

    return NextResponse.json({ entries: data || [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MANUAL_AD_SPEND_FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: getErrorStatus(error) })
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as { storeId?: string; spendDate?: string; amount?: number }
    const storeId = String(body.storeId || '').trim()
    const spendDate = normalizeDate(body.spendDate)
    const amount = Number(body.amount || 0)

    if (!storeId || !spendDate) return NextResponse.json({ error: 'MISSING_MANUAL_SPEND_FIELDS' }, { status: 400 })
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000000) {
      return NextResponse.json({ error: 'INVALID_MANUAL_SPEND_AMOUNT' }, { status: 400 })
    }
    if (spendDate > getCasablancaDateKey()) return NextResponse.json({ error: 'FUTURE_SPEND_DATE' }, { status: 400 })
    const member = await verifyStoreAccess(supabase, user.id, storeId)
    if (!hasPermission(member.role as Role, 'advertising.manage')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const admin = createAdminClient()
    await assertNoAutomaticSpend(admin, storeId, spendDate)
    const currency = await getStoreCurrency(admin, storeId)
    const { data: existing, error: existingError } = await admin
      .from('ad_spend_daily')
      .select('id')
      .eq('store_id', storeId)
      .eq('platform', 'facebook')
      .eq('external_account_id', MANUAL_ACCOUNT_ID)
      .eq('external_campaign_id', MANUAL_CAMPAIGN_ID)
      .gte('spend_date', `${spendDate}T00:00:00.000Z`)
      .lte('spend_date', `${spendDate}T23:59:59.999Z`)
      .maybeSingle()

    if (existingError) throw existingError
    const payload = {
      store_id: storeId,
      spend_date: `${spendDate}T00:00:00.000Z`,
      platform: 'facebook',
      campaign_name: MANUAL_CAMPAIGN_NAME,
      spend: amount,
      spend_currency: currency,
      currency_convert: currency,
      product_id: null,
      external_account_id: MANUAL_ACCOUNT_ID,
      external_campaign_id: MANUAL_CAMPAIGN_ID,
      is_provisional: false,
      raw_metrics: { source: 'manual_daily_entry', entered_by: user.id },
    }

    const mutation = existing?.id
      ? admin.from('ad_spend_daily').update(payload).eq('id', existing.id).select('id').single()
      : admin.from('ad_spend_daily').insert(payload).select('id').single()
    const { data, error } = await mutation
    if (error) throw error

    return NextResponse.json({ ok: true, id: data.id, updated: Boolean(existing?.id) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MANUAL_AD_SPEND_SAVE_FAILED'
    const status = message === 'AUTOMATIC_SPEND_EXISTS' ? 409 : getErrorStatus(error)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()
    const params = new URL(request.url).searchParams
    const storeId = String(params.get('storeId') || '').trim()
    const id = String(params.get('id') || '').trim()
    if (!storeId || !id) return NextResponse.json({ error: 'MISSING_MANUAL_SPEND_ID' }, { status: 400 })
    const member = await verifyStoreAccess(supabase, user.id, storeId)
    if (!hasPermission(member.role as Role, 'advertising.manage')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const admin = createAdminClient()
    const { data: entry, error: entryError } = await admin
      .from('ad_spend_daily')
      .select('id, spend_date')
      .eq('id', id)
      .eq('store_id', storeId)
      .eq('platform', 'facebook')
      .eq('external_account_id', MANUAL_ACCOUNT_ID)
      .eq('external_campaign_id', MANUAL_CAMPAIGN_ID)
      .maybeSingle()

    if (entryError) throw entryError
    if (!entry?.id) return NextResponse.json({ error: 'MANUAL_SPEND_NOT_FOUND' }, { status: 404 })
    const spendDate = String(entry.spend_date).slice(0, 10)
    const { error } = await admin.from('ad_spend_daily').delete().eq('id', entry.id)
    if (error) throw error
    await recalculateDay(admin, storeId, spendDate)

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MANUAL_AD_SPEND_DELETE_FAILED'
    return NextResponse.json({ error: message }, { status: getErrorStatus(error) })
  }
}
