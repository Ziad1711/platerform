import { NextResponse } from 'next/server'
import { assertTrustedOrigin, requireAuthenticatedUser } from '@/lib/assistant/security'
import { requirePermission } from '@/lib/auth/require-permission'
import { listLightfunnelsStores } from '@/lib/integrations/lightfunnels'
import {
  ensureLightfunnelsBindingWebhook,
  getLightfunnelsIntegration,
  isLightfunnelsAuthFailure,
  listLightfunnelsBindings,
  markLightfunnelsAccessInvalid,
  removeLightfunnelsBindingWebhook,
  type LightfunnelsBindingRow,
} from '@/lib/integrations/lightfunnels-bindings'
import { resolveLightfunnelsAccessToken } from '@/lib/integrations/lightfunnels-sync'

const BINDING_COLUMNS =
  'id, integration_id, user_id, store_id, lightfunnels_store_id, lightfunnels_store_name, lightfunnels_account_id, webhook_order_confirmed_id, webhook_target_url, import_cursor, has_more, products_cursor, products_has_more, last_import_at, last_import_scanned, last_import_imported, last_import_skipped, last_import_error, last_products_at, last_products_scanned, last_products_created, last_products_updated, last_products_error'

/**
 * Liaison explicite d'une boutique Lightfunnels à un store Jisra.
 *
 * La liaison est obligatoire : les commandes distantes sont routées par boutique, jamais
 * par ressemblance de nom ni par le store courant du navigateur.
 */
export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()

    const body = (await request.json().catch(() => ({}))) as {
      storeId?: string
      lightfunnelsStoreId?: string
      lightfunnelsStoreName?: string
    }

    const storeId = (body.storeId || '').trim()
    const lightfunnelsStoreId = (body.lightfunnelsStoreId || '').trim()

    if (!storeId) return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    if (!lightfunnelsStoreId) {
      return NextResponse.json({ error: 'MISSING_LIGHTFUNNELS_STORE_ID' }, { status: 400 })
    }

    await requirePermission(storeId, 'integrations.manage')

    const integration = await getLightfunnelsIntegration({ supabase, userId: user.id })
    if (!integration) {
      return NextResponse.json({ error: 'LIGHTFUNNELS_NOT_CONNECTED' }, { status: 400 })
    }

    const { accessToken } = await resolveLightfunnelsAccessToken({
      supabase,
      integrationId: integration.id,
    })

    // La boutique doit réellement appartenir au compte connecté.
    const stores = await listLightfunnelsStores({ accessToken })
    const target = stores.find((store) => String(store.id) === lightfunnelsStoreId)

    if (!target) {
      return NextResponse.json({ error: 'LIGHTFUNNELS_STORE_NOT_FOUND' }, { status: 400 })
    }

    const existing = await listLightfunnelsBindings({ supabase, integrationId: integration.id })
    const sameRemoteStore = existing.find(
      (binding) => binding.lightfunnels_store_id === lightfunnelsStoreId
    )

    if (sameRemoteStore && sameRemoteStore.store_id !== storeId) {
      // Changer de store cible mélangerait deux historiques : retirez d'abord la liaison.
      return NextResponse.json({ error: 'BINDING_EXISTS_OTHER_STORE' }, { status: 409 })
    }

    const { data: savedBinding, error: upsertError } = await supabase
      .from('lightfunnels_store_bindings')
      .upsert(
        {
          integration_id: integration.id,
          user_id: user.id,
          store_id: storeId,
          lightfunnels_store_id: lightfunnelsStoreId,
          lightfunnels_store_name: String(
            body.lightfunnelsStoreName || target.name || target.slug || lightfunnelsStoreId
          ),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'integration_id,lightfunnels_store_id' }
      )
      .select(BINDING_COLUMNS)
      .single()

    if (upsertError) throw upsertError

    const webhook = await ensureLightfunnelsBindingWebhook({
      supabase,
      accessToken,
      integrationId: integration.id,
      binding: savedBinding as LightfunnelsBindingRow,
      requestUrl: request.url,
    })

    return NextResponse.json({
      ok: true,
      binding: savedBinding,
      webhookId: webhook.webhookId,
      warnings: webhook.warnings,
    })
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'UNKNOWN_ERROR'

    // Rejet d'authentification côté Lightfunnels : l'accès doit être renouvelé par
    // l'utilisateur. On marque l'installation pour que l'assistant propose la reconnexion
    // au lieu d'afficher une erreur technique brute.
    if (isLightfunnelsAuthFailure(rawMessage)) {
      console.warn('[lightfunnels][bindings] access rejected by provider', {
        detail: rawMessage.slice(0, 200),
      })

      try {
        const auth = await requireAuthenticatedUser()
        const integration = await getLightfunnelsIntegration({
          supabase: auth.supabase,
          userId: auth.user.id,
        })

        if (integration) {
          await markLightfunnelsAccessInvalid({
            supabase: auth.supabase,
            integrationId: integration.id,
          })
        }
      } catch {
        // Le diagnostic ne doit jamais masquer l'erreur d'origine.
      }

      return NextResponse.json({ error: 'LIGHTFUNNELS_RECONNECT_REQUIRED' }, { status: 409 })
    }

    const status =
      rawMessage === 'UNAUTHORIZED'
        ? 401
        : rawMessage === 'FORBIDDEN' || rawMessage === 'FORBIDDEN_ORIGIN'
          ? 403
          : 500
    console.error('[lightfunnels][bindings] failed', { message: rawMessage })
    return NextResponse.json({ error: rawMessage }, { status })
  }
}

/** Retire une liaison : webhook distant supprimé, historique des commandes conservé. */
export async function DELETE(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()
    const { searchParams } = new URL(request.url)
    const bindingId = (searchParams.get('bindingId') || '').trim()

    if (!bindingId) return NextResponse.json({ error: 'MISSING_BINDING_ID' }, { status: 400 })

    const { data: binding, error: bindingError } = await supabase
      .from('lightfunnels_store_bindings')
      .select(BINDING_COLUMNS)
      .eq('id', bindingId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (bindingError) throw bindingError
    if (!binding) return NextResponse.json({ error: 'BINDING_NOT_FOUND' }, { status: 404 })

    await requirePermission(String(binding.store_id), 'integrations.manage')

    const warnings: string[] = []

    try {
      const { accessToken } = await resolveLightfunnelsAccessToken({
        supabase,
        integrationId: String(binding.integration_id),
      })

      warnings.push(
        ...(await removeLightfunnelsBindingWebhook({
          supabase,
          accessToken,
          binding: binding as LightfunnelsBindingRow,
        }))
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'WEBHOOK_DELETE_FAILED'
      warnings.push(`WEBHOOK_DELETE_FAILED:${message}`)
    }

    const { error: deleteError } = await supabase
      .from('lightfunnels_store_bindings')
      .delete()
      .eq('id', bindingId)
      .eq('user_id', user.id)

    if (deleteError) throw deleteError

    return NextResponse.json({ ok: true, warnings })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
    const status =
      message === 'UNAUTHORIZED'
        ? 401
        : message === 'FORBIDDEN' || message === 'FORBIDDEN_ORIGIN'
          ? 403
          : 500
    console.error('[lightfunnels][bindings] delete failed', { message })
    return NextResponse.json({ error: message }, { status })
  }
}
