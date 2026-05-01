import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import { createClient } from '@/lib/supabase/server'
import { buildFacebookAdsAuthorizeUrl, createFacebookAdsOAuthState } from '@/lib/integrations/facebook-ads'

export async function GET(request: Request) {
  try {
    let authenticatedUserId = ''
    let authenticatedAccessToken = ''
    const authorizationHeader = request.headers.get('authorization') || ''
    const bearerToken = authorizationHeader.startsWith('Bearer ')
      ? authorizationHeader.slice('Bearer '.length).trim()
      : ''

    if (bearerToken) {
      authenticatedAccessToken = bearerToken
      const supabase = await createClient()
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser(bearerToken)

      if (error || !user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
      authenticatedUserId = user.id
    } else {
      const { user } = await requireAuthenticatedUser()
      authenticatedUserId = user.id
    }

    const clientId = process.env.FACEBOOK_APP_ID || ''
    const redirectUri = process.env.FACEBOOK_REDIRECT_URI || ''
    const stateSecret = process.env.FACEBOOK_APP_SECRET || ''

    if (!clientId || !redirectUri || !stateSecret) {
      return NextResponse.json({ error: 'MISSING_FACEBOOK_CONFIG' }, { status: 500 })
    }

    const state = createFacebookAdsOAuthState(
      {
        userId: authenticatedUserId,
        ts: Date.now(),
        accessToken: authenticatedAccessToken || undefined,
      },
      stateSecret
    )

    const authorizationUrl = buildFacebookAdsAuthorizeUrl({
      clientId,
      redirectUri,
      state,
    })

    if (bearerToken) return NextResponse.json({ url: authorizationUrl })
    return NextResponse.redirect(authorizationUrl)
  } catch {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }
}