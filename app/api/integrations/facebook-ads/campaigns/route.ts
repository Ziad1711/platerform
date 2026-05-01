import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
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
    const token = await getFacebookDecryptedToken(admin, String(integration.id))
    const campaigns = await listFacebookCampaigns({ accessToken: token, accountId })
    return NextResponse.json({ campaigns })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FACEBOOK_CAMPAIGNS_FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}