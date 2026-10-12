import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  LIGHTFUNNELS_PROVIDER,
  countLightfunnelsAccountStores,
  getLightfunnelsConfig,
  verifyLightfunnelsWebhookSignature,
} from '@/lib/integrations/lightfunnels'
import {
  hasLightfunnelsOrderMapping,
  resolveLightfunnelsAccessToken,
  upsertLightfunnelsOrderFromPayload,
  type LightfunnelsStoreBinding,
} from '@/lib/integrations/lightfunnels-sync'

const SIGNATURE_HEADER = 'lightfunnels-hmac'
const BINDING_COLUMNS =
  'id, integration_id, user_id, store_id, lightfunnels_store_id, lightfunnels_account_id, webhook_order_confirmed_id, webhook_target_url, import_cursor, has_more'

/**
 * Nombre de boutiques du **compte distant** : seule preuve qu'une commande sans `store_id`
 * est sans ambiguïté. Renvoie `null` si elle ne peut pas être établie (jeton indisponible,
 * appel refusé) — l'appelant refuse alors l'import non prouvé.
 */
async function resolveRemoteStoreCount(params: { supabase: any; integrationId: string }) {
  try {
    const { accessToken } = await resolveLightfunnelsAccessToken({
      supabase: params.supabase,
      integrationId: params.integrationId,
    })

    return await countLightfunnelsAccountStores({ accessToken })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'STORES_LOOKUP_FAILED'
    console.error('[lightfunnels][webhook] remote stores lookup failed', { message })
    return null
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)

  console.info('[lightfunnels][webhook] probe', {
    method: 'GET',
    path: url.pathname,
    integrationId: (url.searchParams.get('integration_id') || '').trim() || null,
  })

  return NextResponse.json({
    ok: true,
    route: 'lightfunnels order webhook',
    integrationId: (url.searchParams.get('integration_id') || '').trim() || null,
  })
}

/**
 * Réception des webhooks de commande (`order/confirmed`).
 *
 * Ordre des contrôles : signature HMAC -> intégration -> liaison de boutique -> compte
 * distant -> idempotence. Cette route utilise le client privilégié (aucune session
 * utilisateur) : ces contrôles sont donc la seule barrière, et l'écriture repasse par la
 * RPC qui revérifie la propriété de l'intégration et l'accès au store.
 */
export async function POST(request: Request) {
  const requestId = `lightfunnels_wh_${Date.now()}`

  try {
    const url = new URL(request.url)
    const integrationId = (url.searchParams.get('integration_id') || '').trim()
    const bindingId = (url.searchParams.get('binding_id') || '').trim()

    if (!integrationId) {
      return NextResponse.json({ error: 'MISSING_INTEGRATION_ID' }, { status: 400 })
    }

    const signature = (request.headers.get(SIGNATURE_HEADER) || '').trim()
    if (!signature) {
      console.warn('[lightfunnels][webhook] missing signature', { requestId, integrationId })
      return NextResponse.json({ error: 'MISSING_SIGNATURE' }, { status: 401 })
    }

    const config = getLightfunnelsConfig()
    if (!config) {
      return NextResponse.json({ error: 'MISSING_LIGHTFUNNELS_CONFIG' }, { status: 500 })
    }

    const rawBody = await request.text()

    if (
      !verifyLightfunnelsWebhookSignature({
        signature,
        rawBody,
        clientSecret: config.clientSecret,
      })
    ) {
      console.warn('[lightfunnels][webhook] invalid signature', {
        requestId,
        integrationId,
        signaturePrefix: signature.slice(0, 8),
      })
      return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 401 })
    }

    let payload: any = null
    try {
      payload = JSON.parse(rawBody || '{}')
    } catch {
      return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
    }

    // Les payloads de webhook encapsulent la ressource dans `node`.
    const order = payload?.node && typeof payload.node === 'object' ? payload.node : payload
    const externalOrderId = String(order?.id || '').trim()

    if (!externalOrderId) {
      return NextResponse.json({ error: 'MISSING_ORDER_ID' }, { status: 400 })
    }

    const remoteStoreId = String(order?.store_id || '').trim()

    if (!remoteStoreId && !bindingId) {
      console.warn('[lightfunnels][webhook] payload without store_id', { requestId, integrationId })
      return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { data: integration, error: integrationError } = await supabase
      .from('integrations')
      .select('id, user_id, status')
      .eq('id', integrationId)
      .eq('provider', LIGHTFUNNELS_PROVIDER)
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration) {
      return NextResponse.json({ error: 'INTEGRATION_NOT_FOUND' }, { status: 404 })
    }

    // Une installation déconnectée ne doit plus rien traiter, même si un webhook distant
    // n'a pas pu être supprimé.
    if (String(integration.status || '') !== 'connected') {
      console.warn('[lightfunnels][webhook] integration not connected', {
        requestId,
        integrationId,
        status: integration.status || null,
      })
      return NextResponse.json({ error: 'INTEGRATION_DISCONNECTED' }, { status: 403 })
    }

    // La liaison est identifiée par l'URL du webhook (`binding_id`) : chaque boutique liée a
    // donc sa propre cible. Le `store_id` du payload sert de contrôle croisé.
    let bindingQuery = supabase
      .from('lightfunnels_store_bindings')
      .select(BINDING_COLUMNS)
      .eq('integration_id', integration.id)

    bindingQuery = bindingId
      ? bindingQuery.eq('id', bindingId)
      : bindingQuery.eq('lightfunnels_store_id', remoteStoreId)

    const { data: bindingRow, error: bindingError } = await bindingQuery.maybeSingle()

    if (bindingError) throw bindingError
    if (!bindingRow) {
      console.warn('[lightfunnels][webhook] no binding for this target', {
        requestId,
        integrationId,
        bindingId: bindingId || null,
        remoteStoreId: remoteStoreId || null,
      })
      return NextResponse.json({ error: 'MISSING_STORE_BINDING' }, { status: 400 })
    }

    if (remoteStoreId && String(bindingRow.lightfunnels_store_id) !== remoteStoreId) {
      console.warn('[lightfunnels][webhook] store mismatch', {
        requestId,
        integrationId,
        remoteStoreId,
      })
      return NextResponse.json({ error: 'STORE_MISMATCH' }, { status: 403 })
    }

    const accountId = String(order?.account_id || '').trim()
    if (
      bindingRow.lightfunnels_account_id &&
      accountId &&
      String(bindingRow.lightfunnels_account_id) !== accountId
    ) {
      console.warn('[lightfunnels][webhook] account mismatch', { requestId, integrationId })
      return NextResponse.json({ error: 'ACCOUNT_MISMATCH' }, { status: 403 })
    }

    const warnings: string[] = []

    // Une commande sans `store_id` ne peut pas être routée avec certitude : la preuve exigée
    // porte sur le **compte distant** (une seule boutique chez Lightfunnels), pas sur le
    // nombre de liaisons Jisra. Plusieurs boutiques, ou une preuve impossible à établir,
    // imposent de refuser plutôt que de deviner.
    if (!remoteStoreId) {
      const remoteStores = await resolveRemoteStoreCount({
        supabase,
        integrationId: integration.id as string,
      })

      if (remoteStores !== 1) {
        console.warn('[lightfunnels][webhook] order without store_id cannot be routed', {
          requestId,
          integrationId,
          remoteStores,
        })
        return NextResponse.json({ error: 'MISSING_REMOTE_STORE' }, { status: 400 })
      }

      warnings.push('ORDER_WITHOUT_REMOTE_STORE')
    }

    // L'identité du compte distant est mémorisée dès qu'elle est connue : les appels
    // suivants la vérifient au lieu de se fier à la seule URL du webhook.
    if (!bindingRow.lightfunnels_account_id && accountId) {
      const { error: rememberError } = await supabase
        .from('lightfunnels_store_bindings')
        .update({ lightfunnels_account_id: accountId, updated_at: new Date().toISOString() })
        .eq('id', bindingRow.id)

      if (rememberError) {
        console.error('[lightfunnels][webhook] account id not saved', {
          requestId,
          bindingId: bindingRow.id,
          error: rememberError.message,
        })
      }
    }

    // Idempotence : une commande déjà liée n'est jamais réécrite.
    if (
      await hasLightfunnelsOrderMapping({
        supabase,
        integrationId: integration.id,
        lightfunnelsOrderId: externalOrderId,
      })
    ) {
      return NextResponse.json({ ok: true, status: 'already_imported' })
    }

    const { data: storeRow } = await supabase
      .from('stores')
      .select('currency')
      .eq('id', bindingRow.store_id)
      .maybeSingle()

    const result = await upsertLightfunnelsOrderFromPayload({
      supabase,
      integrationId: integration.id,
      userId: String(integration.user_id),
      binding: bindingRow as LightfunnelsStoreBinding,
      order,
      sinceDate: null,
      storeCurrency: (storeRow as { currency?: string | null } | null)?.currency ?? null,
      // L'absence de `store_id` n'a été acceptée ci-dessus que pour une seule boutique liée :
      // la commande est donc sans ambiguïté.
      allowMissingStoreId: !remoteStoreId,
    })

    for (const warning of result.warnings || []) {
      if (!warnings.includes(warning)) warnings.push(warning)
    }

    console.info('[lightfunnels][webhook] processed', {
      requestId,
      integrationId,
      externalOrderId,
      status: result.status,
      reason: result.reason || null,
      orderId: result.orderId || null,
    })

    return NextResponse.json({
      ok: true,
      status: result.status,
      reason: result.reason || null,
      orderId: result.orderId || null,
      warnings,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'LIGHTFUNNELS_WEBHOOK_FAILED'
    console.error('[lightfunnels][webhook] failed', { requestId, message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
