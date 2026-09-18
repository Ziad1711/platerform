import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, getErrorStatus, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { normalizeFacebookSyncMode } from '@/lib/integrations/facebook-ads-sync'

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const storeId = String(new URL(request.url).searchParams.get('storeId') || '').trim()
    if (storeId) await verifyStoreAccess(supabase, user.id, storeId)

    const admin = createAdminClient()
    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'facebook-ads')
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration?.id) return NextResponse.json({ connected: false, accounts: [] })

    const [{ data: accounts, error: accountsError }, { data: configs, error: configsError }] = await Promise.all([
      admin
        .from('facebook_ad_accounts')
        .select('id, account_id, account_name, account_currency, timezone_name, timezone_offset_hours')
        .eq('integration_id', integration.id)
        .eq('is_active', true)
        .order('account_name', { ascending: true }),
      storeId
        ? admin
            .from('facebook_ad_account_store_configs')
            .select('ad_account_id, sync_mode, is_active')
            .eq('integration_id', integration.id)
            .eq('store_id', storeId)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (accountsError) throw accountsError
    if (configsError) throw configsError

    const configByAccount = new Map<string, any>(
      (configs || []).map((row: any) => [String(row.ad_account_id), row] as const)
    )
    const rows = (accounts || []).map((account: any) => {
      const config = configByAccount.get(String(account.id)) as any
      return {
        ...account,
        store_id: config ? storeId : null,
        sync_mode: config?.sync_mode || 'product',
        is_active: Boolean(config?.is_active),
      }
    })

    return NextResponse.json({ connected: true, accounts: rows })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FACEBOOK_ACCOUNTS_FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: getErrorStatus(error) })
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      selectedAccountIds?: string[]
      storeId?: string
      syncMode?: string
    }
    const selectedAccountIds = Array.isArray(body.selectedAccountIds)
      ? Array.from(new Set(body.selectedAccountIds.map((value) => String(value || '').trim()).filter(Boolean)))
      : []
    const storeId = String(body.storeId || '').trim()
    const syncMode = normalizeFacebookSyncMode(body.syncMode)

    if (!storeId) return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    if (selectedAccountIds.length === 0) return NextResponse.json({ error: 'MISSING_AD_ACCOUNT' }, { status: 400 })
    await verifyStoreAccess(supabase, user.id, storeId)

    const admin = createAdminClient()
    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'facebook-ads')
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration?.id) return NextResponse.json({ error: 'FACEBOOK_INTEGRATION_NOT_FOUND' }, { status: 404 })

    const { data: ownedAccounts, error: ownedAccountsError } = await admin
      .from('facebook_ad_accounts')
      .select('id')
      .eq('integration_id', integration.id)
      .in('id', selectedAccountIds)

    if (ownedAccountsError) throw ownedAccountsError
    if ((ownedAccounts || []).length !== selectedAccountIds.length) {
      return NextResponse.json({ error: 'INVALID_AD_ACCOUNT_SELECTION' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const { error: upsertError } = await admin.from('facebook_ad_account_store_configs').upsert(
      selectedAccountIds.map((adAccountId) => ({
        integration_id: integration.id,
        user_id: user.id,
        store_id: storeId,
        ad_account_id: adAccountId,
        sync_mode: syncMode,
        is_active: true,
        updated_at: now,
      })),
      { onConflict: 'store_id,ad_account_id' }
    )

    if (upsertError) throw upsertError

    const { error: deactivateError } = await admin
      .from('facebook_ad_account_store_configs')
      .update({ is_active: false, updated_at: now })
      .eq('integration_id', integration.id)
      .eq('store_id', storeId)
      .not('ad_account_id', 'in', `(${selectedAccountIds.join(',')})`)

    if (deactivateError) throw deactivateError
    return NextResponse.json({ ok: true, syncMode })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FACEBOOK_ACCOUNTS_SAVE_FAILED'
    return NextResponse.json({ error: message }, { status: getErrorStatus(error) })
  }
}
