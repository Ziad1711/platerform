import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, getErrorStatus, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { hasPermission, type Role } from '@/lib/auth/permissions'
import { getCasablancaDateKey, resolveFacebookExchangeRate } from '@/lib/integrations/facebook-ads-sync'
import type { SpendImportMode } from '@/lib/ads/spend-csv'

const CSV_ACCOUNT_ID = '__csv__'
const MAX_ROWS = 20000
const ALLOWED_PLATFORMS = ['facebook']

type IncomingRow = {
  date?: string
  campaignKey?: string
  campaignName?: string | null
  spend?: number
  impressions?: number
  clicks?: number
  reach?: number
  frequency?: number
  ctr?: number
  cpc?: number
  cpm?: number
  purchases?: number
  conversion_value?: number
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toNonNegative(value: unknown) {
  return Math.max(0, toNumber(value, 0))
}

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      storeId?: string
      mode?: SpendImportMode
      platform?: string
      fileCurrency?: string
      rows?: IncomingRow[]
    }

    const storeId = String(body.storeId || '').trim()
    const mode: SpendImportMode = body.mode === 'advanced' ? 'advanced' : 'simple'
    const platform = String(body.platform || 'facebook').trim().toLowerCase()
    const rows = Array.isArray(body.rows) ? body.rows : []

    if (!storeId) return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    if (!ALLOWED_PLATFORMS.includes(platform)) {
      return NextResponse.json({ error: 'UNSUPPORTED_PLATFORM' }, { status: 400 })
    }
    if (rows.length === 0) return NextResponse.json({ error: 'NO_ROWS_TO_IMPORT' }, { status: 400 })
    if (rows.length > MAX_ROWS) return NextResponse.json({ error: 'TOO_MANY_ROWS' }, { status: 400 })

    const member = await verifyStoreAccess(supabase, user.id, storeId)
    if (!hasPermission(member.role as Role, 'advertising.manage')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const admin = createAdminClient()
    const { data: store, error: storeError } = await admin
      .from('stores')
      .select('currency, owner_user_id')
      .eq('id', storeId)
      .single()

    if (storeError) throw storeError

    const storeCurrency = String(store?.currency || 'MAD').toUpperCase()
    const ownerUserId = store?.owner_user_id ? String(store.owner_user_id) : null
    const fileCurrency = String(body.fileCurrency || storeCurrency).trim().toUpperCase() || storeCurrency
    if (fileCurrency.length !== 3) return NextResponse.json({ error: 'INVALID_CURRENCY' }, { status: 400 })

    const today = getCasablancaDateKey()
    const sanitized: Array<Record<string, unknown>> = []
    const rateCache = new Map<string, number>()

    for (const [index, row] of rows.entries()) {
      const date = String(row.date || '').trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json({ error: `INVALID_DATE_ROW_${index + 2}` }, { status: 400 })
      }
      if (date > today) {
        return NextResponse.json({ error: `FUTURE_DATE_ROW_${index + 2}` }, { status: 400 })
      }

      const spend = toNonNegative(row.spend)
      if (!Number.isFinite(Number(row.spend)) || spend < 0) {
        return NextResponse.json({ error: `INVALID_SPEND_ROW_${index + 2}` }, { status: 400 })
      }

      let rate = rateCache.get(date)
      if (rate === undefined) {
        const resolved =
          fileCurrency === storeCurrency
            ? 1
            : await resolveFacebookExchangeRate(admin, ownerUserId, fileCurrency, storeCurrency, date)

        if (!resolved || resolved <= 0) {
          return NextResponse.json(
            {
              error: `EXCHANGE_RATE_NOT_FOUND:${fileCurrency}->${storeCurrency}`,
              hint: 'Ajoutez le taux de change dans Paramètres → Taux de change.',
            },
            { status: 400 }
          )
        }

        rate = resolved
        rateCache.set(date, rate)
      }

      const impressions = Math.round(toNonNegative(row.impressions))
      const clicks = Math.round(toNonNegative(row.clicks))
      const reach = Math.round(toNonNegative(row.reach))
      const purchases = Math.round(toNonNegative(row.purchases))
      const conversionValue = toNonNegative(row.conversion_value)
      const campaignKey = String(row.campaignKey || 'csv_daily').trim() || 'csv_daily'
      const campaignName = String(row.campaignName || '').trim()

      sanitized.push({
        store_id: storeId,
        spend_date: `${date}T00:00:00.000Z`,
        platform,
        campaign_name:
          campaignName || (mode === 'simple' ? 'Import CSV (dépense quotidienne)' : 'Import CSV Ads Manager'),
        spend,
        spend_currency: fileCurrency,
        currency_convert: storeCurrency,
        spend_converted: Number((spend * rate).toFixed(4)),
        product_id: null,
        external_account_id: CSV_ACCOUNT_ID,
        external_campaign_id: campaignKey,
        is_provisional: false,
        impressions,
        clicks,
        reach,
        frequency: toNonNegative(row.frequency),
        ctr: toNonNegative(row.ctr),
        cpc: toNonNegative(row.cpc),
        cpm: toNonNegative(row.cpm),
        cpp: 0,
        cpc_converted: Number((toNonNegative(row.cpc) * rate).toFixed(4)),
        cpm_converted: Number((toNonNegative(row.cpm) * rate).toFixed(4)),
        cpp_converted: 0,
        actions_total: purchases,
        purchases,
        conversion_value: conversionValue,
        conversion_value_converted: Number((conversionValue * rate).toFixed(4)),
        conversion_value_currency: fileCurrency,
        raw_metrics: { source: 'csv_import', mode, imported_by: user.id },
      })
    }

    const dates = sanitized.map((row) => String(row.spend_date).slice(0, 10)).sort()
    const minDate = dates[0]
    const maxDate = dates[dates.length - 1]

    const { error: deleteError } = await admin
      .from('ad_spend_daily')
      .delete()
      .eq('store_id', storeId)
      .eq('platform', platform)
      .eq('external_account_id', CSV_ACCOUNT_ID)
      .gte('spend_date', `${minDate}T00:00:00.000Z`)
      .lte('spend_date', `${maxDate}T23:59:59.999Z`)

    if (deleteError) throw deleteError

    const { error: insertError } = await admin.from('ad_spend_daily').insert(sanitized)
    if (insertError) throw insertError

    return NextResponse.json({
      ok: true,
      inserted: sanitized.length,
      mode,
      fileCurrency,
      storeCurrency,
      dateFrom: minDate,
      dateTo: maxDate,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SPEND_IMPORT_FAILED'
    return NextResponse.json({ error: message }, { status: getErrorStatus(error) })
  }
}

