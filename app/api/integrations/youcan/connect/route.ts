import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import { buildYouCanAuthorizeUrl, createYouCanOAuthState } from '@/lib/integrations/youcan'
import { createClient } from '@/lib/supabase/server'

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

      if (error || !user) {
        return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
      }

      authenticatedUserId = user.id
    } else {
      const { user } = await requireAuthenticatedUser()
      authenticatedUserId = user.id
    }

    const { searchParams } = new URL(request.url)
    const store = (searchParams.get('store') || process.env.YOUCAN_DEFAULT_STORE || '').trim()
    const storeId = (searchParams.get('storeId') || '').trim()

    if (!store) {
      return NextResponse.json({ error: 'MISSING_STORE' }, { status: 400 })
    }

    const clientId = process.env.YOUCAN_CLIENT_ID || ''
    const redirectUri = process.env.YOUCAN_REDIRECT_URI || ''

    if (!clientId || !redirectUri) {
      return NextResponse.json({ error: 'MISSING_YOUCAN_CONFIG' }, { status: 500 })
    }

    const stateSecret = process.env.YOUCAN_CLIENT_SECRET || ''
    if (!stateSecret || !authenticatedUserId) {
      return NextResponse.json({ error: 'MISSING_YOUCAN_CONFIG' }, { status: 500 })
    }

    const state = createYouCanOAuthState(
      {
        userId: authenticatedUserId,
        store,
        ts: Date.now(),
        accessToken: authenticatedAccessToken || undefined,
        storeId: storeId || undefined,
      } as any,
      stateSecret
    )

    const authorizationUrl = buildYouCanAuthorizeUrl({
      store,
      clientId,
      redirectUri,
      state,
    })

    if (bearerToken) {
      return NextResponse.json({ url: authorizationUrl })
    }

    return NextResponse.redirect(authorizationUrl)
  } catch {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }
}
