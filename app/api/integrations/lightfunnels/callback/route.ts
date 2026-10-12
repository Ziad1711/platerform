import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import {
  LIGHTFUNNELS_PROVIDER,
  exchangeLightfunnelsCode,
  getLightfunnelsConfig,
  parseLightfunnelsOAuthState,
} from '@/lib/integrations/lightfunnels'
import { encryptSecret } from '@/lib/security/crypto'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * La connexion se déroule dans une fenêtre surgissante : le retour prévient la page
 * ouvrante puis se ferme. Le message ne porte aucune donnée sensible.
 */
function popupHtml(params: { origin: string; message?: string }) {
  const payload = JSON.stringify({
    type: params.message ? 'LIGHTFUNNELS_INTEGRATION_FAILED' : 'LIGHTFUNNELS_INTEGRATION_CONNECTED',
    message: params.message || null,
  })

  return `<!doctype html>
<html lang="fr">
  <head><meta charset="utf-8" /><title>Lightfunnels</title></head>
  <body style="font-family: system-ui, sans-serif; padding: 24px;">
    <p>${params.message ? `Connexion Lightfunnels échouée : ${escapeHtml(params.message)}` : 'Connexion réussie. Vous pouvez fermer cette fenêtre.'}</p>
    <script>
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(${payload}, ${JSON.stringify(params.origin)});
        }
      } catch (error) {}
      ${params.message ? '' : 'window.close();'}
    </script>
  </body>
</html>`
}

function tokenExpiryFrom(expiresIn: unknown): string | null {
  const seconds = Number(expiresIn)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(Date.now() + seconds * 1000).toISOString()
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const origin = requestUrl.origin

  try {
    const code = (requestUrl.searchParams.get('code') || '').trim()
    const rawState = (requestUrl.searchParams.get('state') || '').trim()

    const config = getLightfunnelsConfig()
    if (!config) {
      return new NextResponse(popupHtml({ origin, message: 'MISSING_LIGHTFUNNELS_CONFIG' }), {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    const state = parseLightfunnelsOAuthState(rawState, config.clientSecret)
    if (!state) {
      return new NextResponse(popupHtml({ origin, message: 'INVALID_STATE' }), {
        status: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    if (!code) {
      return new NextResponse(popupHtml({ origin, message: 'MISSING_CODE' }), {
        status: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    // La session (cookie) est la seule source d'identité : aucun jeton ne transite par le state.
    const { supabase, user } = await requireAuthenticatedUser()

    if (user.id !== state.userId) {
      return new NextResponse(popupHtml({ origin, message: 'STATE_USER_MISMATCH' }), {
        status: 403,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    const tokens = await exchangeLightfunnelsCode({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
    })

    const { data: provider, error: providerError } = await supabase
      .from('integration_providers')
      .select('id')
      .eq('slug', LIGHTFUNNELS_PROVIDER)
      .maybeSingle()

    if (providerError) throw providerError
    if (!provider) {
      return new NextResponse(popupHtml({ origin, message: 'MISSING_PROVIDER' }), {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    const payload = {
      provider_id: provider.id,
      access_token: encryptSecret(String(tokens.access_token)),
      refresh_token: tokens.refresh_token ? encryptSecret(String(tokens.refresh_token)) : null,
      token_expires_at: tokenExpiryFrom(tokens.expires_in),
      status: 'connected',
      updated_at: new Date().toISOString(),
    }

    // Une installation par utilisateur : `store_id` reste vide, les liaisons de boutiques
    // portent le rattachement aux stores Jisra (contrainte unique (user_id, provider, store_id)).
    const { data: existing, error: existingError } = await supabase
      .from('integrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', LIGHTFUNNELS_PROVIDER)
      .maybeSingle()

    if (existingError) throw existingError

    if (existing?.id) {
      const { error: updateError } = await supabase
        .from('integrations')
        .update(payload)
        .eq('id', existing.id)
      if (updateError) throw updateError
    } else {
      const { error: insertError } = await supabase
        .from('integrations')
        .insert({ user_id: user.id, provider: LIGHTFUNNELS_PROVIDER, store_id: null, ...payload })
      if (insertError) throw insertError
    }

    console.info('[lightfunnels][callback] integration saved', { userId: user.id })

    return new NextResponse(popupHtml({ origin }), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
    console.error('[lightfunnels][callback] failed', { message })

    return new NextResponse(popupHtml({ origin, message }), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
}
