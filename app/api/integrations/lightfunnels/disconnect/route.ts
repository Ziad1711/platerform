import { NextResponse } from 'next/server'
import { assertTrustedOrigin, requireAuthenticatedUser } from '@/lib/assistant/security'
import { requireAnyPermission, requirePermission } from '@/lib/auth/require-permission'
import {
  getLightfunnelsIntegration,
  listLightfunnelsBindings,
  removeLightfunnelsBindingWebhook,
  type LightfunnelsBindingRow,
} from '@/lib/integrations/lightfunnels-bindings'
import { resolveLightfunnelsAccessToken } from '@/lib/integrations/lightfunnels-sync'

/**
 * Déconnexion Lightfunnels. Le périmètre est explicite :
 * - `bindingId` fourni : une seule boutique est détachée ;
 * - sinon : toute l'installation est retirée (toutes les liaisons + l'accès).
 *
 * Les commandes déjà importées et leurs mappings sont conservés : une reconnexion ne
 * recrée donc pas les commandes, et aucun historique n'est perdu.
 */
export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()

    const body = (await request.json().catch(() => ({}))) as { bindingId?: string }
    const bindingId = (body.bindingId || '').trim()
    const warnings: string[] = []
    const scope = bindingId ? 'binding' : 'account'

    const integration = await getLightfunnelsIntegration({ supabase, userId: user.id })

    if (!integration) {
      // Déjà déconnecté : opération idempotente.
      return NextResponse.json({ ok: true, scope, removedBindings: 0, warnings })
    }

    const bindings = await listLightfunnelsBindings({ supabase, integrationId: integration.id })
    const targets = bindingId ? bindings.filter((binding) => binding.id === bindingId) : bindings

    if (bindingId && targets.length === 0) {
      return NextResponse.json({ error: 'BINDING_NOT_FOUND' }, { status: 404 })
    }

    if (bindingId) {
      await requirePermission(targets[0].store_id, 'integrations.manage')
    } else {
      await requireAnyPermission('integrations.manage')
    }

    let accessToken: string | null = null

    try {
      accessToken = (
        await resolveLightfunnelsAccessToken({ supabase, integrationId: integration.id })
      ).accessToken
    } catch (error) {
      const message = error instanceof Error ? error.message : 'TOKEN_UNAVAILABLE'
      warnings.push(`TOKEN_UNAVAILABLE:${message}`)
    }

    for (const binding of targets) {
      if (!accessToken) {
        warnings.push('WEBHOOK_NOT_REMOVED_REMOTELY')
        break
      }

      warnings.push(
        ...(await removeLightfunnelsBindingWebhook({
          supabase,
          accessToken,
          binding: binding as LightfunnelsBindingRow,
        }))
      )
    }

    if (targets.length > 0) {
      const { error: deleteBindingsError } = await supabase
        .from('lightfunnels_store_bindings')
        .delete()
        .in(
          'id',
          targets.map((binding) => binding.id)
        )
        .eq('user_id', user.id)

      if (deleteBindingsError) throw deleteBindingsError
    }

    if (!bindingId) {
      // L'installation est conservée, seuls les jetons sont effacés : les mappings des
      // commandes déjà importées restent en place, donc une reconnexion ne recrée pas de
      // doublons (l'import reconnaît les commandes déjà liées).
      const { error: clearError } = await supabase
        .from('integrations')
        .update({
          access_token: '',
          refresh_token: null,
          token_expires_at: null,
          status: 'disconnected',
          updated_at: new Date().toISOString(),
        })
        .eq('id', integration.id)
        .eq('user_id', user.id)

      if (clearError) throw clearError
    }

    console.info('[lightfunnels][disconnect] done', {
      userId: user.id,
      scope,
      removedBindings: targets.length,
    })

    return NextResponse.json({
      ok: true,
      scope,
      removedBindings: targets.length,
      warnings,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'LIGHTFUNNELS_DISCONNECT_FAILED'
    const status =
      message === 'UNAUTHORIZED'
        ? 401
        : message === 'FORBIDDEN' || message === 'FORBIDDEN_ORIGIN'
          ? 403
          : 500
    console.error('[lightfunnels][disconnect] failed', { message })
    return NextResponse.json({ error: message }, { status })
  }
}
