import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import {
  parseYouCanOAuthState,
  exchangeYouCanCodeForToken,
  normalizeYouCanStore,
} from '@/lib/integrations/youcan'
import { encryptSecret } from '@/lib/security/crypto'
import { createClient } from '@/lib/supabase/server'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function popupSuccessHtml(targetOrigin: string) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>YouCan connected</title>
  </head>
  <body>
    <script>
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: 'YOUCAN_INTEGRATION_CONNECTED' }, ${JSON.stringify(targetOrigin)});
        }
      } catch (e) {}
      window.close();
      document.body.textContent = 'Connexion réussie. Vous pouvez fermer cette fenêtre.';
    </script>
  </body>
</html>`
}

function popupErrorHtml(message: string) {
  const safeMessage = escapeHtml(message)
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>YouCan connection error</title>
  </head>
  <body style="font-family: sans-serif; padding: 16px;">
    <h3>Connexion YouCan échouée</h3>
    <p>${safeMessage}</p>
  </body>
</html>`
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url)
    const requestId = `youcan_cb_${Date.now()}`
    const clientSecret = process.env.YOUCAN_CLIENT_SECRET || ''
    if (!clientSecret) {
      console.error('[youcan][callback] missing config', { requestId })
      return NextResponse.json({ error: 'MISSING_YOUCAN_CONFIG' }, { status: 500 })
    }

    const { searchParams, origin } = requestUrl
    const isPopup = searchParams.get('popup') === '1'
    const rawState = (searchParams.get('state') || '').trim()
    const code = (searchParams.get('code') || '').trim()
    const parsedState = rawState ? parseYouCanOAuthState(rawState, clientSecret) : null
    const queryStore = normalizeYouCanStore((searchParams.get('store') || '').trim())
    const store = queryStore || normalizeYouCanStore(parsedState?.store || '')

    console.info('[youcan][callback] received', {
      requestId,
      origin,
      isPopup,
      hasCode: Boolean(code),
      hasState: Boolean(rawState),
      queryStore,
      stateStore: parsedState?.store || '',
      store,
      hasHmac: Boolean(searchParams.get('hmac')),
    })

    let supabase: Awaited<ReturnType<typeof createClient>>
    let userId = ''

    try {
      const auth = await requireAuthenticatedUser()
      supabase = auth.supabase
      userId = auth.user.id
    } catch {
      if (!parsedState?.accessToken) {
        console.warn('[youcan][callback] unauthorized: missing access token in state', { requestId })
        if (isPopup) {
          return new NextResponse(popupErrorHtml('UNAUTHORIZED'), {
            status: 401,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        }
        return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
      }

      const serverSupabase = await createClient()
      const {
        data: { user },
        error: userError,
      } = await serverSupabase.auth.getUser(parsedState.accessToken)

      if (userError || !user) {
        console.warn('[youcan][callback] unauthorized: failed supabase getUser from state token', {
          requestId,
          error: userError?.message,
        })
        if (isPopup) {
          return new NextResponse(popupErrorHtml('UNAUTHORIZED'), {
            status: 401,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        }
        return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
      }

      supabase = serverSupabase
      userId = user.id
    }

    if (!code || !store) {
      console.warn('[youcan][callback] missing code or store', { requestId, hasCode: Boolean(code), store })
      if (isPopup) {
        return new NextResponse(popupErrorHtml('MISSING_CODE_OR_STORE'), {
          status: 400,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      return NextResponse.json({ error: 'MISSING_CODE_OR_STORE' }, { status: 400 })
    }

    const clientId = process.env.YOUCAN_CLIENT_ID || ''
    const redirectUri = process.env.YOUCAN_REDIRECT_URI || ''

    if (!clientId || !clientSecret) {
      console.error('[youcan][callback] missing config values', {
        requestId,
        hasClientId: Boolean(clientId),
        hasClientSecret: Boolean(clientSecret),
        hasRedirectUri: Boolean(redirectUri),
      })
      if (isPopup) {
        return new NextResponse(popupErrorHtml('MISSING_YOUCAN_CONFIG'), {
          status: 500,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      return NextResponse.json({ error: 'MISSING_YOUCAN_CONFIG' }, { status: 500 })
    }

    const tokenResponse = await exchangeYouCanCodeForToken({
      code,
      clientId,
      clientSecret,
      redirectUri: redirectUri || undefined,
    })

    console.info('[youcan][callback] token exchange success', {
      requestId,
      hasAccessToken: Boolean(tokenResponse.access_token),
      hasRefreshToken: Boolean(tokenResponse.refresh_token),
    })

    const accessToken = tokenResponse.access_token
    if (!accessToken) {
      console.error('[youcan][callback] missing access token after exchange', { requestId })
      if (isPopup) {
        return new NextResponse(popupErrorHtml('MISSING_ACCESS_TOKEN'), {
          status: 502,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      return NextResponse.json({ error: 'MISSING_ACCESS_TOKEN' }, { status: 502 })
    }

    const encryptedAccessToken = encryptSecret(accessToken)
    const encryptedRefreshToken = tokenResponse.refresh_token
      ? encryptSecret(String(tokenResponse.refresh_token))
      : null

    const { data: provider, error: providerError } = await supabase
      .from('integration_providers')
      .select('id')
      .eq('slug', 'youcan')
      .maybeSingle()

    if (providerError) {
      console.error('[youcan][callback] provider query error', {
        requestId,
        error: providerError.message,
      })
      if (isPopup) {
        return new NextResponse(popupErrorHtml(providerError.message || 'PROVIDER_ERROR'), {
          status: 500,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      return NextResponse.json({ error: providerError.message }, { status: 500 })
    }

    if (!provider) {
      console.error('[youcan][callback] missing provider row', { requestId })
      if (isPopup) {
        return new NextResponse(popupErrorHtml('MISSING_PROVIDER'), {
          status: 500,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      return NextResponse.json({ error: 'MISSING_PROVIDER' }, { status: 500 })
    }

    const normalizedStoreDomain = `${store}.youcan.shop`

    const { error } = await supabase.from('integrations').upsert(
      {
        user_id: userId,
        provider: 'youcan',
        provider_id: provider.id,
        store_domain: normalizedStoreDomain,
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        status: 'connected',
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'user_id,provider',
      }
    ).select('id').single()

    if (error) {
      console.error('[youcan][callback] integration upsert failed', {
        requestId,
        error: error.message,
      })
      if (isPopup) {
        return new NextResponse(popupErrorHtml(error.message || 'INTEGRATION_SAVE_FAILED'), {
          status: 500,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { data: savedIntegration } = await supabase
      .from('integrations')
      .select('id')
      .eq('user_id', userId)
      .eq('provider', 'youcan')
      .maybeSingle()

    const stateStoreId = (parsedState as any)?.storeId || null
    if (savedIntegration?.id && stateStoreId) {
      await supabase.from('youcan_integration_configs').upsert({
        integration_id: savedIntegration.id,
        user_id: userId,
        store_id: stateStoreId,
        updated_at: new Date().toISOString()
      }, { onConflict: 'integration_id' })
      
      console.info('[youcan][callback] integration config saved', {
        requestId,
        integrationId: savedIntegration.id,
        storeId: stateStoreId
      })

      // Trigger initial sync automatically
      try {
        const syncUrl = new URL('/api/integrations/youcan/sync', origin)
        // We use a background fetch to not delay the redirect
        fetch(syncUrl.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tokenResponse.access_token}` // The fresh token from YouCan
          },
          body: JSON.stringify({
            storeId: stateStoreId,
            importProducts: true,
            importOrders: true
          })
        }).catch(err => console.error('[youcan][callback] auto-sync trigger failed', err))
        
        console.info('[youcan][callback] auto-sync triggered', { requestId })
      } catch (syncErr) {
        console.error('[youcan][callback] failed to setup auto-sync', syncErr)
      }
    }

    console.info('[youcan][callback] integration saved successfully', {
      requestId,
      userId,
      store: normalizedStoreDomain,
    })

    if (isPopup) {
        return new NextResponse(popupSuccessHtml(origin), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    return NextResponse.redirect(`${origin}/dashboard/integrations?connected=youcan`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
    console.error('[youcan][callback] unhandled error', {
      message,
    })
    if (new URL(request.url).searchParams.get('popup') === '1') {
      return new NextResponse(popupErrorHtml(message), {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
