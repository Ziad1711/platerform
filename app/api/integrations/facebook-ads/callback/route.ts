import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import {
  exchangeFacebookCodeForToken,
  exchangeFacebookLongLivedToken,
  getFacebookUser,
  listFacebookAdAccounts,
  parseFacebookAdsOAuthState,
} from '@/lib/integrations/facebook-ads'
import { getFacebookAdsProviderId } from '@/lib/integrations/facebook-ads-connect'
import { createClient } from '@/lib/supabase/server'
import { encryptSecret } from '@/lib/security/crypto'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function popupSuccessHtml(targetOrigin: string) {
  return `<!doctype html><html><body><script>try{if(window.opener&&!window.opener.closed){window.opener.postMessage({type:'FACEBOOK_ADS_INTEGRATION_CONNECTED'},${JSON.stringify(targetOrigin)})}}catch(e){}window.close();document.body.textContent='Connexion réussie.';</script></body></html>`
}

function popupErrorHtml(message: string) {
  const safeMessage = escapeHtml(message)
  return `<!doctype html><html><body style="font-family:sans-serif;padding:16px;"><h3>Connexion Facebook Ads échouée</h3><p>${safeMessage}</p></body></html>`
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url)
    const origin = requestUrl.origin
    const code = String(requestUrl.searchParams.get('code') || '').trim()
    const rawState = String(requestUrl.searchParams.get('state') || '').trim()
    const isPopup = true
    const appId = process.env.FACEBOOK_APP_ID || ''
    const appSecret = process.env.FACEBOOK_APP_SECRET || ''
    const redirectUri = process.env.FACEBOOK_REDIRECT_URI || ''

    if (!appId || !appSecret || !redirectUri) {
      return new NextResponse(popupErrorHtml('MISSING_FACEBOOK_CONFIG'), { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    const parsedState = rawState ? parseFacebookAdsOAuthState(rawState, appSecret) : null
    let userId = ''

    try {
      const auth = await requireAuthenticatedUser()
      userId = auth.user.id
    } catch {
      if (!parsedState?.accessToken) {
        return new NextResponse(popupErrorHtml('UNAUTHORIZED'), { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      }
      const serverSupabase = await createClient()
      const {
        data: { user },
      } = await serverSupabase.auth.getUser(parsedState.accessToken)
      if (!user) {
        return new NextResponse(popupErrorHtml('UNAUTHORIZED'), { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      }
      userId = user.id
    }

    if (!code || !userId) {
      return new NextResponse(popupErrorHtml('MISSING_CODE_OR_USER'), { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    const tokenResponse = await exchangeFacebookCodeForToken({ clientId: appId, clientSecret: appSecret, redirectUri, code })
    const shortLivedToken = String(tokenResponse.access_token || '')
    if (!shortLivedToken) {
      return new NextResponse(popupErrorHtml('MISSING_ACCESS_TOKEN'), { status: 502, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    const longLivedTokenResponse = await exchangeFacebookLongLivedToken({
      clientId: appId,
      clientSecret: appSecret,
      accessToken: shortLivedToken,
    })

    const accessToken = String(longLivedTokenResponse.access_token || shortLivedToken)
    const expiresIn = Number(longLivedTokenResponse.expires_in || tokenResponse.expires_in || 0)
    const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null
    const [me, adAccounts] = await Promise.all([
      getFacebookUser(accessToken),
      listFacebookAdAccounts(accessToken),
    ])

    const admin = createAdminClient()
    const providerId = await getFacebookAdsProviderId(admin)
    const now = new Date().toISOString()
    const encryptedToken = encryptSecret(accessToken)

    const { data: integration, error: existingError } = await admin
      .from('integrations')
      .select('id')
      .eq('user_id', userId)
      .eq('provider', 'facebook-ads')
      .maybeSingle()

    if (existingError) throw existingError

    let integrationId = String(integration?.id || '')
    if (integrationId) {
      const { error } = await admin
        .from('integrations')
        .update({
          provider_id: providerId,
          access_token: encryptedToken,
          status: 'connected',
          token_expires_at: expiresAt,
          meta_user_id: me.id || null,
          granted_scopes: ['ads_read', 'business_management'],
          updated_at: now,
        })
        .eq('id', integrationId)
      if (error) throw error
    } else {
      const { data, error } = await admin
        .from('integrations')
        .insert({
          user_id: userId,
          provider: 'facebook-ads',
          provider_id: providerId,
          access_token: encryptedToken,
          status: 'connected',
          token_expires_at: expiresAt,
          meta_user_id: me.id || null,
          granted_scopes: ['ads_read', 'business_management'],
          updated_at: now,
        })
        .select('id')
        .single()
      if (error) throw error
      integrationId = String(data.id)
    }

    if (adAccounts.length > 0) {
      const { error } = await admin.from('facebook_ad_accounts').upsert(
        adAccounts.map((account) => ({
          integration_id: integrationId,
          user_id: userId,
          account_id: account.accountId,
          account_name: account.accountName,
          account_currency: account.accountCurrency,
          timezone_name: account.timezoneName,
          timezone_offset_hours: account.timezoneOffsetHours,
          is_active: account.isActive,
          updated_at: now,
        })),
        { onConflict: 'integration_id,account_id' }
      )
      if (error) throw error
    }

    return new NextResponse(popupSuccessHtml(origin), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FACEBOOK_CALLBACK_FAILED'
    return new NextResponse(popupErrorHtml(message), { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
}