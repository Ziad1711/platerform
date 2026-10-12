import { NextResponse } from 'next/server'
import { assertTrustedOrigin, requireAuthenticatedUser } from '@/lib/assistant/security'
import { requirePermission } from '@/lib/auth/require-permission'
import {
  getLightfunnelsIntegration,
  listLightfunnelsBindings,
  type LightfunnelsBindingRow,
} from '@/lib/integrations/lightfunnels-bindings'
import {
  LIGHTFUNNELS_DEFAULT_SINCE_DATE,
  importLightfunnelsOrders,
  resolveLightfunnelsAccessToken,
  type LightfunnelsImportSummary,
} from '@/lib/integrations/lightfunnels-sync'
import { importLightfunnelsProducts, type LightfunnelsProductImportSummary } from '@/lib/integrations/lightfunnels-catalog'

const MAX_PAGES_LIMIT = 40

function normalizeSinceDate(input: unknown) {
  const raw = String(input || '').trim() || LIGHTFUNNELS_DEFAULT_SINCE_DATE
  const min = new Date(LIGHTFUNNELS_DEFAULT_SINCE_DATE)
  const parsed = new Date(raw)

  if (Number.isNaN(parsed.getTime()) || parsed < min) return LIGHTFUNNELS_DEFAULT_SINCE_DATE

  return parsed.toISOString().slice(0, 10)
}

function normalizeMaxPages(input: unknown) {
  const value = Number(input)
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.min(Math.trunc(value), MAX_PAGES_LIMIT)
}

/** État d'import des liaisons du store (lecture seule). */
export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const { searchParams } = new URL(request.url)
    const storeId = (searchParams.get('storeId') || '').trim()

    if (!storeId) return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })

    await requirePermission(storeId, 'integrations.view')

    const integration = await getLightfunnelsIntegration({ supabase, userId: user.id })
    if (!integration) return NextResponse.json({ bindings: [] })

    const bindings = await listLightfunnelsBindings({ supabase, integrationId: integration.id })

    return NextResponse.json({
      bindings: bindings.filter((binding) => binding.store_id === storeId),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
    const status = message === 'UNAUTHORIZED' ? 401 : message === 'FORBIDDEN' ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

/**
 * Import / rattrapage des commandes Lightfunnels.
 *
 * Une liaison doit être ciblée sans ambiguïté : si le store possède plusieurs boutiques
 * distantes liées, `bindingId` est obligatoire (aucun choix implicite).
 */
export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()

    const body = (await request.json().catch(() => ({}))) as {
      storeId?: string
      bindingId?: string
      sinceDate?: string
      maxPages?: number
      importProducts?: boolean
      importOrders?: boolean
    }

    // Deux étapes indépendantes, chacune pouvant être ignorée : rien n'est lancé par défaut.
    const importProducts = body.importProducts === true
    const importOrders = body.importOrders === true

    const storeId = (body.storeId || '').trim()
    if (!storeId) return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })

    if (!importProducts && !importOrders) {
      return NextResponse.json({ error: 'NOTHING_SELECTED' }, { status: 400 })
    }

    await requirePermission(storeId, 'integrations.manage')

    // L'import écrit des commandes et des articles : la RLS Jisra exige aussi les droits
    // de gestion des ventes. Sans ce contrôle, un rôle autorisé à gérer les intégrations
    // mais pas les ventes échouerait sur une erreur de base peu lisible.
    await requirePermission(storeId, 'sales.write')

    const integration = await getLightfunnelsIntegration({ supabase, userId: user.id })
    if (!integration) {
      return NextResponse.json({ error: 'LIGHTFUNNELS_NOT_CONNECTED' }, { status: 400 })
    }

    if (String(integration.status || '') !== 'connected') {
      return NextResponse.json({ error: 'LIGHTFUNNELS_NOT_CONNECTED' }, { status: 400 })
    }

    const bindings = await listLightfunnelsBindings({ supabase, integrationId: integration.id })
    const storeBindings = bindings.filter((binding) => binding.store_id === storeId)

    if (storeBindings.length === 0) {
      return NextResponse.json({ error: 'NO_LIGHTFUNNELS_BINDING' }, { status: 400 })
    }

    const requestedBindingId = (body.bindingId || '').trim()

    if (requestedBindingId && !storeBindings.some((binding) => binding.id === requestedBindingId)) {
      return NextResponse.json({ error: 'BINDING_NOT_FOUND' }, { status: 404 })
    }

    if (!requestedBindingId && storeBindings.length > 1) {
      return NextResponse.json({ error: 'BINDING_REQUIRED' }, { status: 400 })
    }

    const { accessToken } = await resolveLightfunnelsAccessToken({
      supabase,
      integrationId: integration.id,
    })

    const sinceDate = normalizeSinceDate(body.sinceDate)
    const maxPages = normalizeMaxPages(body.maxPages)
    const targets = requestedBindingId
      ? storeBindings.filter((binding) => binding.id === requestedBindingId)
      : storeBindings

    const results: Array<
      LightfunnelsImportSummary & { bindingId: string; storeId: string; lightfunnelsStoreId: string }
    > = []

    // Étape « produits » : catalogue + variantes de **chaque** boutique ciblée, avec un
    // résultat par liaison (comme les commandes) — un bilan agrégé masquerait la boutique
    // en cause.
    const productResults: Array<
      LightfunnelsProductImportSummary & {
        bindingId: string
        storeId: string
        lightfunnelsStoreId: string
      }
    > = []

    if (importProducts) {
      for (const binding of targets) {
        try {
          const summary = await importLightfunnelsProducts({
            supabase,
            integrationId: integration.id,
            userId: user.id,
            binding: binding as LightfunnelsBindingRow,
            accessToken,
            maxPages,
          })

          productResults.push({
            ...summary,
            bindingId: binding.id,
            storeId: binding.store_id,
            lightfunnelsStoreId: binding.lightfunnels_store_id,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'LIGHTFUNNELS_PRODUCTS_FAILED'
          console.error('[lightfunnels][catalog] failed', { bindingId: binding.id, message })

          await supabase
            .from('lightfunnels_store_bindings')
            .update({ last_products_error: message, updated_at: new Date().toISOString() })
            .eq('id', binding.id)

          productResults.push({
            ok: false,
            reason: message,
            scanned: 0,
            productsCreated: 0,
            productsUpdated: 0,
            productsMatched: 0,
            variantsCreated: 0,
            variantsUpdated: 0,
            skipped: 0,
            skippedReasons: {},
            // Un échec laisse le catalogue incomplet : la relance doit reprendre.
            hasMore: true,
            warnings: [message],
            bindingId: binding.id,
            storeId: binding.store_id,
            lightfunnelsStoreId: binding.lightfunnels_store_id,
          })
        }
      }
    }

    for (const binding of targets) {
      // Étape « commandes » ignorée : l'utilisateur a demandé de ne pas les importer.
      if (!importOrders) break

      try {
        const summary = await importLightfunnelsOrders({
          supabase,
          integrationId: integration.id,
          userId: user.id,
          binding: binding as LightfunnelsBindingRow,
          accessToken,
          sinceDate,
          maxPages,
        })

        results.push({
          ...summary,
          bindingId: binding.id,
          storeId: binding.store_id,
          lightfunnelsStoreId: binding.lightfunnels_store_id,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'LIGHTFUNNELS_IMPORT_FAILED'
        console.error('[lightfunnels][sync] failed', { bindingId: binding.id, message })

        await supabase
          .from('lightfunnels_store_bindings')
          .update({ last_import_error: message, updated_at: new Date().toISOString() })
          .eq('id', binding.id)

        results.push({
          ok: false,
          reason: message,
          scanned: 0,
          imported: 0,
          alreadyImported: 0,
          skipped: 0,
          skippedReasons: {},
          warnings: [message],
          hasMore: true,
          cursor: binding.import_cursor,
          bindingId: binding.id,
          storeId: binding.store_id,
          lightfunnelsStoreId: binding.lightfunnels_store_id,
        })
      }
    }

    return NextResponse.json({
      ok: productResults.every((result) => result.ok) && results.every((result) => result.ok),
      products: importProducts ? productResults : [],
      orders: importOrders ? results : [],
      importedProducts: productResults.reduce((total, result) => total + result.productsCreated, 0),
      importedOrders: results.reduce((total, result) => total + result.imported, 0),
      warnings: Array.from(
        new Set([
          ...productResults.flatMap((result) => result.warnings),
          ...results.flatMap((result) => result.warnings),
        ])
      ),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'LIGHTFUNNELS_SYNC_FAILED'
    const status =
      message === 'UNAUTHORIZED'
        ? 401
        : message === 'FORBIDDEN' || message === 'FORBIDDEN_ORIGIN'
          ? 403
          : 500
    console.error('[lightfunnels][sync] failed', { message })
    return NextResponse.json({ error: message }, { status })
  }
}
