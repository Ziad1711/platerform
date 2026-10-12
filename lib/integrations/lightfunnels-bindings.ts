import {
  LIGHTFUNNELS_PROVIDER,
  LIGHTFUNNELS_WEBHOOK_EVENT_ORDER_CONFIRMED,
  createLightfunnelsWebhook,
  deleteLightfunnelsWebhook,
  listLightfunnelsWebhooks,
} from '@/lib/integrations/lightfunnels'

type SupabaseLike = any

export type LightfunnelsBindingRow = {
  id: string
  integration_id: string
  user_id: string
  store_id: string
  lightfunnels_store_id: string
  lightfunnels_store_name: string | null
  lightfunnels_account_id: string | null
  webhook_order_confirmed_id: string | null
  webhook_target_url: string | null
  import_cursor: string | null
  has_more: boolean
  products_cursor: string | null
  products_has_more: boolean
  last_import_at: string | null
  last_import_scanned: number
  last_import_imported: number
  last_import_skipped: number
  last_import_error: string | null
  last_products_at: string | null
  last_products_scanned: number
  last_products_created: number
  last_products_updated: number
  last_products_error: string | null
}

export async function getLightfunnelsIntegration(params: {
  supabase: SupabaseLike
  userId: string
}) {
  const { data, error } = await params.supabase
    .from('integrations')
    .select('id, user_id, status, token_expires_at, created_at')
    .eq('user_id', params.userId)
    .eq('provider', LIGHTFUNNELS_PROVIDER)
    .maybeSingle()

  if (error) throw error
  return data || null
}

export async function listLightfunnelsBindings(params: {
  supabase: SupabaseLike
  integrationId: string
}) {
  const { data, error } = await params.supabase
    .from('lightfunnels_store_bindings')
    .select(
      'id, integration_id, user_id, store_id, lightfunnels_store_id, lightfunnels_store_name, lightfunnels_account_id, webhook_order_confirmed_id, webhook_target_url, import_cursor, has_more, products_cursor, products_has_more, last_import_at, last_import_scanned, last_import_imported, last_import_skipped, last_import_error, last_products_at, last_products_scanned, last_products_created, last_products_updated, last_products_error'
    )
    .eq('integration_id', params.integrationId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data || []) as LightfunnelsBindingRow[]
}

/**
 * Marque l'accès Lightfunnels comme invalide : le rejet d'un appel (401/403) signifie que
 * l'installation doit être reconnectée, ce que `/status` remonte via `needsReconnect`.
 */
export async function markLightfunnelsAccessInvalid(params: {
  supabase: SupabaseLike
  integrationId: string
}) {
  await params.supabase
    .from('integrations')
    .update({ status: 'error', updated_at: new Date().toISOString() })
    .eq('id', params.integrationId)
}

/** Un rejet d'authentification côté Lightfunnels impose une reconnexion du compte. */
export function isLightfunnelsAuthFailure(message: string) {
  return /LIGHTFUNNELS_HTTP_(401|403)/.test(String(message || ''))
}

/**
 * Origine publique utilisée comme cible du webhook : l'URL de redirection configurée est
 * prioritaire (elle est nécessairement publique et déclarée chez Lightfunnels).
 */
export function resolveLightfunnelsPublicOrigin(requestUrl: string) {
  const warnings: string[] = []
  const configured = (process.env.LIGHTFUNNELS_REDIRECT_URI || '').trim()

  if (configured) {
    try {
      return { origin: new URL(configured).origin, warnings }
    } catch {
      warnings.push('LIGHTFUNNELS_REDIRECT_URI_INVALID')
    }
  }

  const origin = new URL(requestUrl).origin
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
    warnings.push('PUBLIC_URL_LOCALHOST')
  }

  return { origin, warnings }
}

/**
 * Cible du webhook. Elle porte l'identifiant de la **liaison** : chaque boutique liée a donc
 * son propre webhook, et détacher une boutique ne coupe pas les autres.
 */
export function buildLightfunnelsWebhookTargetUrl(params: {
  origin: string
  integrationId: string
  bindingId: string
}) {
  const search = new URLSearchParams({
    integration_id: params.integrationId,
    binding_id: params.bindingId,
  })

  return `${params.origin}/api/integrations/lightfunnels/webhook?${search.toString()}`
}

/**
 * Enregistre (ou réutilise) le webhook `order/confirmed` de la boutique.
 *
 * `order/confirmed` est préféré à `order/created` : il est émis une fois le parcours
 * d'achat terminé, upsells et downsells compris.
 */
export async function ensureLightfunnelsBindingWebhook(params: {
  supabase: SupabaseLike
  accessToken: string
  integrationId: string
  binding: LightfunnelsBindingRow
  requestUrl: string
}) {
  const { supabase, accessToken, integrationId, binding } = params
  const warnings: string[] = []
  const { origin, warnings: originWarnings } = resolveLightfunnelsPublicOrigin(params.requestUrl)
  warnings.push(...originWarnings)

  if (!origin) {
    return { webhookId: null as string | null, targetUrl: null as string | null, warnings }
  }

  const targetUrl = buildLightfunnelsWebhookTargetUrl({
    origin,
    integrationId,
    bindingId: binding.id,
  })

  try {
    const existing = await listLightfunnelsWebhooks({ accessToken })
    const match = existing.find(
      (hook) =>
        String(hook.type || '').trim() === LIGHTFUNNELS_WEBHOOK_EVENT_ORDER_CONFIRMED &&
        String(hook.url || '').trim() === targetUrl
    )

    if (!match?.id) {
      const created = await createLightfunnelsWebhook({
        accessToken,
        type: LIGHTFUNNELS_WEBHOOK_EVENT_ORDER_CONFIRMED,
        url: targetUrl,
      })

      const createdId = created?.id ? String(created.id) : null

      await supabase
        .from('lightfunnels_store_bindings')
        .update({
          webhook_order_confirmed_id: createdId,
          webhook_target_url: targetUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', binding.id)

      return { webhookId: createdId, targetUrl, warnings }
    }

    await supabase
      .from('lightfunnels_store_bindings')
      .update({
        webhook_order_confirmed_id: String(match.id),
        webhook_target_url: targetUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', binding.id)

    return { webhookId: String(match.id), targetUrl, warnings }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'WEBHOOK_REGISTRATION_FAILED'
    console.error('[lightfunnels][webhook] registration failed', {
      integrationId,
      bindingId: binding.id,
      message,
    })
    warnings.push(`WEBHOOK_REGISTRATION_FAILED:${message}`)

    // L'import manuel reste possible : l'échec d'enregistrement n'est jamais bloquant.
    return { webhookId: null, targetUrl, warnings }
  }
}

/** Supprime le webhook distant avant de retirer la liaison (échec distant signalé). */
export async function removeLightfunnelsBindingWebhook(params: {
  supabase: SupabaseLike
  accessToken: string
  binding: LightfunnelsBindingRow
}) {
  const { supabase, accessToken, binding } = params
  const warnings: string[] = []

  if (binding.webhook_order_confirmed_id) {
    try {
      await deleteLightfunnelsWebhook({
        accessToken,
        webhookId: binding.webhook_order_confirmed_id,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'WEBHOOK_DELETE_FAILED'
      console.error('[lightfunnels][webhook] delete failed', { bindingId: binding.id, message })
      warnings.push(`WEBHOOK_DELETE_FAILED:${message}`)
    }
  }

  await supabase
    .from('lightfunnels_store_bindings')
    .update({
      webhook_order_confirmed_id: null,
      webhook_target_url: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', binding.id)

  return warnings
}
