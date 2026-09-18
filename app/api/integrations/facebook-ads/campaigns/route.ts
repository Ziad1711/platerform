import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getErrorStatus, requireAuthenticatedUser } from '@/lib/assistant/security'
import { listFacebookCampaigns } from '@/lib/integrations/facebook-ads'
import { getFacebookDecryptedToken, getFacebookIntegration } from '@/lib/integrations/facebook-ads-connect'

export async function GET(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser()
    const accountId = String(new URL(request.url).searchParams.get('accountId') || '').trim()
    if (!accountId) return NextResponse.json({ error: 'MISSING_ACCOUNT_ID' }, { status: 400 })

    const admin = createAdminClient()
    const integration = await getFacebookIntegration(admin, user.id)
    if (!integration?.id) return NextResponse.json({ campaigns: [] })
    const { data: account, error: accountError } = await admin
      .from('facebook_ad_accounts')
      .select('id')
      .eq('integration_id', integration.id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (accountError) throw accountError
    if (!account?.id) return NextResponse.json({ error: 'FACEBOOK_AD_ACCOUNT_NOT_FOUND' }, { status: 404 })

    const token = await getFacebookDecryptedToken(admin, String(integration.id))
    const campaigns = await listFacebookCampaigns({ accessToken: token, accountId })
    return NextResponse.json({ campaigns })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FACEBOOK_CAMPAIGNS_FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: getErrorStatus(error) })
  }
}
