import { NextResponse } from 'next/server'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import {
  importYouCanOrders,
  importYouCanProducts,
} from '@/lib/integrations/youcan-sync'
import {
  deleteYouCanRestHook,
  getYouCanRestHookTargetUrl,
  listYouCanRestHooks,
  resolveYouCanPublicBaseUrl,
  subscribeYouCanRestHook,
  type YouCanRestHookRecord,
} from '@/lib/integrations/youcan'
import { decryptSecret, encryptSecret, isEncryptedSecret } from '@/lib/security/crypto'
import { createClient as createServerSupabaseClient } from '@/lib/supabase/server'

const DEFAULT_SINCE_DATE = '2026-01-01'

function normalizeSinceDate(input: string | undefined) {
  const date = input?.trim() || DEFAULT_SINCE_DATE
  const min = new Date(DEFAULT_SINCE_DATE)
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return DEFAULT_SINCE_DATE
  if (parsed < min) return DEFAULT_SINCE_DATE
  return parsed.toISOString().slice(0, 10)
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message

  if (error && typeof error === 'object') {
    const e = error as {
      message?: unknown
      details?: unknown
      hint?: unknown
      code?: unknown
    }

    const parts = [e.message, e.details, e.hint, e.code]
      .filter((value) => typeof value === 'string' && value.trim().length > 0)
      .map((value) => String(value))

    if (parts.length > 0) return parts.join(' | ')
  }

  return 'YOUCAN_SYNC_FAILED'
}

export async function POST(request: Request) {
  let supabase: any = null
  let user: any = null
  let jobId: string | null = null
  const warnings: string[] = []

  try {
    assertTrustedOrigin(request)
    const authorizationHeader = request.headers.get('authorization') || ''
    const bearerToken = authorizationHeader.startsWith('Bearer ')
      ? authorizationHeader.slice('Bearer '.length).trim()
      : ''

    if (bearerToken) {
      supabase = await createServerSupabaseClient()
      const {
        data: { user: bearerUser },
        error: bearerError,
      } = await supabase.auth.getUser(bearerToken)

      if (bearerError || !bearerUser) {
        return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
      }

      user = bearerUser
    } else {
      const authCtx = await requireAuthenticatedUser()
      supabase = authCtx.supabase
      user = authCtx.user
    }

    const body = (await request.json().catch(() => ({}))) as {
      storeId?: string
      importProducts?: boolean
      importOrders?: boolean
      sinceDate?: string
    }

    const storeId = (body.storeId || '').trim()
    if (!storeId) {
      return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    }

    await verifyStoreAccess(supabase, user.id, storeId)

    const importProducts = body.importProducts !== false
    const importOrders = body.importOrders !== false
    if (!importProducts && !importOrders) {
      return NextResponse.json({ error: 'NOTHING_TO_IMPORT' }, { status: 400 })
    }

    const sinceDate = importOrders ? normalizeSinceDate(body.sinceDate) : DEFAULT_SINCE_DATE

    // Résoudre l'intégration YouCan via le storeId (multi-tenant safe)
    const { data: youcanConfig, error: configError } = await supabase
      .from('youcan_integration_configs')
      .select('integration_id')
      .eq('store_id', storeId)
      .maybeSingle()

    if (configError) throw configError

    let integrationId: string | null = youcanConfig?.integration_id || null

    // Fallback: chercher par user_id si pas de config (ancien setup)
    if (!integrationId) {
      const { data: fallbackIntegration, error: fallbackError } = await supabase
        .from('integrations')
        .select('id')
        .eq('user_id', user.id)
        .eq('provider', 'youcan')
        .eq('status', 'connected')
        .maybeSingle()

      if (fallbackError) throw fallbackError
      integrationId = fallbackIntegration?.id || null
    }

    if (!integrationId) {
      return NextResponse.json({ error: 'YOUCAN_NOT_CONNECTED' }, { status: 400 })
    }

    const { data: integration, error: integrationError } = await supabase
      .from('integrations')
      .select('id, access_token, status')
      .eq('id', integrationId)
      .eq('provider', 'youcan')
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration || integration.status !== 'connected') {
      return NextResponse.json({ error: 'YOUCAN_NOT_CONNECTED' }, { status: 400 })
    }

    const decryptedAccessToken = decryptSecret(String(integration.access_token || ''))
    if (!decryptedAccessToken) {
      return NextResponse.json({ error: 'YOUCAN_NOT_CONNECTED' }, { status: 400 })
    }

    if (!isEncryptedSecret(String(integration.access_token || ''))) {
      await supabase
        .from('integrations')
        .update({ access_token: encryptSecret(decryptedAccessToken), updated_at: new Date().toISOString() })
        .eq('id', integration.id)
    }

    const { data: job, error: jobInsertError } = await supabase
      .from('youcan_sync_jobs')
      .insert({
        user_id: user.id,
        integration_id: integration.id,
        store_id: storeId,
        since_date: sinceDate,
        import_products: importProducts,
        import_orders: importOrders,
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (jobInsertError) throw jobInsertError
    jobId = job.id

    await supabase.from('youcan_integration_configs').upsert(
      {
        integration_id: integration.id,
        user_id: user.id,
        store_id: storeId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'integration_id' }
    )

    let importedProducts = 0
    let importedOrders = 0

    if (importProducts) {
      importedProducts = await importYouCanProducts({
        supabase,
        integrationId: integration.id,
        userId: user.id,
        storeId,
        accessToken: decryptedAccessToken,
      })

      await supabase
        .from('youcan_sync_jobs')
        .update({ progress_products: 100, updated_at: new Date().toISOString() })
        .eq('id', job.id)
    }

    if (importOrders) {
      importedOrders = await importYouCanOrders({
        supabase,
        integrationId: integration.id,
        userId: user.id,
        storeId,
        accessToken: decryptedAccessToken,
        sinceDate,
      })

      await supabase
        .from('youcan_sync_jobs')
        .update({ progress_orders: 100, updated_at: new Date().toISOString() })
        .eq('id', job.id)
    }

    const publicBaseUrl = resolveYouCanPublicBaseUrl({
      requestUrl: request.url,
      configuredRedirectUri: process.env.YOUCAN_REDIRECT_URI,
    })

    warnings.push(...publicBaseUrl.warnings)

    if (publicBaseUrl.warnings.length > 0) {
      console.warn('[youcan][sync] public base url warnings', {
        userId: user.id,
        integrationId: integration.id,
        warnings: publicBaseUrl.warnings,
        source: publicBaseUrl.source,
        origin: publicBaseUrl.origin,
      })
    }

    if (publicBaseUrl.origin) {
      const targetUrl = `${publicBaseUrl.origin}/api/integrations/youcan/webhook/order-create?integration_id=${encodeURIComponent(integration.id)}`

      try {
        const hooks = await listYouCanRestHooks({ accessToken: decryptedAccessToken })
        const orderCreateHooks = hooks.filter(
          (hook: YouCanRestHookRecord) => String(hook.event || '').trim() === 'order.create'
        )
        const matchingHook = orderCreateHooks.find(
          (hook: YouCanRestHookRecord) => getYouCanRestHookTargetUrl(hook) === targetUrl
        )

        let webhookId = matchingHook?.id || null

        if (!webhookId) {
          for (const hook of orderCreateHooks) {
            if (!hook.id) continue
            await deleteYouCanRestHook({
              accessToken: decryptedAccessToken,
              subscriptionId: hook.id,
            })
          }

          const subscription = await subscribeYouCanRestHook({
            accessToken: decryptedAccessToken,
            event: 'order.create',
            targetUrl,
          })
          webhookId = subscription.id || null
          warnings.push('order.create webhook recreated with current target URL.')
        } else {
          warnings.push('Existing order.create webhook already matches current target URL.')
        }

        await supabase.from('youcan_integration_configs').upsert(
          {
            integration_id: integration.id,
            user_id: user.id,
            store_id: storeId,
            webhook_order_create_id: webhookId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'integration_id' }
        )

        const verifiedHooks = await listYouCanRestHooks({ accessToken: decryptedAccessToken })
        const verifiedHook = verifiedHooks.find(
          (hook: YouCanRestHookRecord) =>
            String(hook.event || '').trim() === 'order.create' &&
            getYouCanRestHookTargetUrl(hook) === targetUrl
        )

        if (!verifiedHook?.id) {
          throw new Error('YOUCAN_WEBHOOK_VERIFY_FAILED: order.create target URL not found after subscribe')
        }

        console.info('[youcan][sync] webhook ready', {
          userId: user.id,
          integrationId: integration.id,
          targetUrl,
          webhookId: verifiedHook.id,
          source: publicBaseUrl.source,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'WEBHOOK_SUBSCRIBE_FAILED'
        const canRepairExistingSubscription =
          message.includes('429') ||
          message.toLowerCase().includes('max of subscriptions') ||
          message.toLowerCase().includes('max subscriptions')

        if (!canRepairExistingSubscription) {
          throw error
        }

        warnings.push('Webhook subscription limit reached; attempting repair.')

        let repairedExistingHook = false

        try {
          const hooks = await listYouCanRestHooks({ accessToken: decryptedAccessToken })

          console.info('[youcan][sync] hooks listed for repair', {
            userId: user.id,
            integrationId: integration.id,
            totalHooks: hooks.length,
            hooks: hooks.map((h: YouCanRestHookRecord) => ({
              id: h.id,
              event: h.event,
              targetUrl: getYouCanRestHookTargetUrl(h),
            })),
          })

          const orderCreateHooks = hooks.filter(
            (hook: YouCanRestHookRecord) => String(hook.event || '').trim() === 'order.create'
          )

          const matchingHook = orderCreateHooks.find(
            (hook: YouCanRestHookRecord) => getYouCanRestHookTargetUrl(hook) === targetUrl
          )

          if (matchingHook?.id) {
            await supabase.from('youcan_integration_configs').upsert(
              {
                integration_id: integration.id,
                user_id: user.id,
                store_id: storeId,
                webhook_order_create_id: matchingHook.id,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'integration_id' }
            )

            warnings.push('Existing order.create webhook already matches current target URL.')
            repairedExistingHook = true
          } else {
            // Force delete ALL order.create hooks regardless of target URL
            for (const hook of orderCreateHooks) {
              if (!hook.id) continue
              console.info('[youcan][sync] deleting stale order.create hook', {
                hookId: hook.id,
                event: hook.event,
                targetUrl: getYouCanRestHookTargetUrl(hook),
              })
              await deleteYouCanRestHook({
                accessToken: decryptedAccessToken,
                subscriptionId: hook.id,
              })
            }

            // Also delete any hooks with old/stale target URLs that might be blocking
            const nonOrderCreateHooks = hooks.filter(
              (hook: YouCanRestHookRecord) => String(hook.event || '').trim() !== 'order.create'
            )
            for (const hook of nonOrderCreateHooks) {
              const hookTargetUrl = getYouCanRestHookTargetUrl(hook)
              if (hookTargetUrl && hookTargetUrl.includes('/api/integrations/youcan/webhook/order-create')) {
                if (!hook.id) continue
                console.info('[youcan][sync] deleting stale hook with wrong event but our target URL', {
                  hookId: hook.id,
                  event: hook.event,
                  targetUrl: hookTargetUrl,
                })
                await deleteYouCanRestHook({
                  accessToken: decryptedAccessToken,
                  subscriptionId: hook.id,
                })
              }
            }

            const replacement = await subscribeYouCanRestHook({
              accessToken: decryptedAccessToken,
              event: 'order.create',
              targetUrl,
            })

            console.info('[youcan][sync] new webhook subscribed after repair', {
              userId: user.id,
              integrationId: integration.id,
              newWebhookId: replacement.id,
              targetUrl,
            })

            await supabase.from('youcan_integration_configs').upsert(
              {
                integration_id: integration.id,
                user_id: user.id,
                store_id: storeId,
                webhook_order_create_id: replacement.id || null,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'integration_id' }
            )

            warnings.push('Stale order.create webhook(s) removed and recreated with current target URL.')
            repairedExistingHook = true
          }
        } catch (restHookError) {
          const restHookMessage = restHookError instanceof Error ? restHookError.message : 'RESTHOOK_REPAIR_FAILED'
          console.error('[youcan][sync] webhook repair failed', {
            userId: user.id,
            integrationId: integration.id,
            error: restHookMessage,
          })
          warnings.push(`Webhook auto-repair failed: ${restHookMessage}`)
        }

        if (!repairedExistingHook) {
          warnings.push('Unable to confirm current webhook target automatically.');
        }
      }
    }

    await supabase
      .from('youcan_sync_jobs')
      .update({
        status: 'completed',
        progress_products: importProducts ? 100 : 0,
        progress_orders: importOrders ? 100 : 0,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      importedProducts,
      importedOrders,
      warnings,
      debug: {
        publicBaseUrl: publicBaseUrl.origin,
        webhookId,
        source: publicBaseUrl.source,
      }
    })
  } catch (error) {
    const message = extractErrorMessage(error)

    if (jobId && supabase) {
      await supabase
        .from('youcan_sync_jobs')
        .update({
          status: 'failed',
          error: message,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)
    }

    console.error('[youcan][sync] failed', { userId: user?.id || null, jobId, message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET() {
  try {
    const { supabase, user } = await requireAuthenticatedUser()

    const { data, error } = await supabase
      .from('youcan_sync_jobs')
      .select('id, status, since_date, import_products, import_orders, progress_products, progress_orders, error, created_at, finished_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ jobs: data || [] })
  } catch {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }
}
