import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser } from '@/lib/assistant/security'

export async function POST() {
  try {
    const { user } = await requireAuthenticatedUser()
    const admin = createAdminClient()
    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'facebook-ads')
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration?.id) return NextResponse.json({ ok: true })

    await admin.from('facebook_campaign_mappings').delete().eq('integration_id', integration.id)
    await admin.from('facebook_ad_accounts').delete().eq('integration_id', integration.id)
    await admin.from('facebook_sync_jobs').delete().eq('integration_id', integration.id)
    await admin.from('facebook_sync_errors').delete().eq('integration_id', integration.id)
    const { error } = await admin.from('integrations').delete().eq('id', integration.id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FACEBOOK_DISCONNECT_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}