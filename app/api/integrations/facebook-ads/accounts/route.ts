import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser } from '@/lib/assistant/security'

export async function GET() {
  try {
    const { user } = await requireAuthenticatedUser()
    const admin = createAdminClient()
    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('provider', 'facebook-ads')
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration?.id) return NextResponse.json({ connected: false, accounts: [] })

    const { data, error } = await admin
      .from('facebook_ad_accounts')
      .select('id, account_id, account_name, account_currency, timezone_name, timezone_offset_hours, is_active')
      .eq('integration_id', integration.id)
      .order('account_name', { ascending: true })

    if (error) throw error
    return NextResponse.json({ connected: true, accounts: data || [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FACEBOOK_ACCOUNTS_FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as { selectedAccountIds?: string[] }
    const selectedAccountIds = Array.isArray(body.selectedAccountIds)
      ? body.selectedAccountIds.map((value) => String(value || '').trim()).filter(Boolean)
      : []

    const admin = createAdminClient()
    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'facebook-ads')
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration?.id) return NextResponse.json({ error: 'FACEBOOK_INTEGRATION_NOT_FOUND' }, { status: 404 })

    const { error: resetError } = await admin
      .from('facebook_ad_accounts')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('integration_id', integration.id)

    if (resetError) throw resetError

    if (selectedAccountIds.length > 0) {
      const { error: activateError } = await admin
        .from('facebook_ad_accounts')
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq('integration_id', integration.id)
        .in('id', selectedAccountIds)

      if (activateError) throw activateError
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FACEBOOK_ACCOUNTS_SAVE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}