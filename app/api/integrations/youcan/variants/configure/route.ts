import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { normalizeStockMultiplier } from '@/lib/integrations/variant-stock'

type ConfigureBody = {
  storeId?: string
  productId?: string
  stockTrackingMode?: string
  variants?: Array<{ id?: string; stockMultiplier?: number | string }>
}

/**
 * Confirme la configuration de stock des variantes importées (packs quantité).
 * - stockTrackingMode: 'shared' (un seul stock produit) ou 'variant' (stock par variante)
 * - variants: multiplicateur d'unités physiques par unité vendue
 */
export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()

    const body = (await request.json().catch(() => ({}))) as ConfigureBody
    const storeId = String(body.storeId || '').trim()
    const productId = String(body.productId || '').trim()
    const stockTrackingMode = body.stockTrackingMode === 'shared' ? 'shared' : 'variant'

    if (!storeId || !productId) {
      return NextResponse.json({ error: 'MISSING_REQUIRED_FIELDS' }, { status: 400 })
    }

    await verifyStoreAccess(supabase, user.id, storeId)

    const admin = createAdminClient()
    const now = new Date().toISOString()

    const { error: productError } = await admin
      .from('products')
      .update({
        stock_tracking_mode: stockTrackingMode,
        stock_setup_confirmed_at: now,
        updated_at: now,
      })
      .eq('id', productId)
      .eq('store_id', storeId)

    if (productError) throw productError

    const variants = Array.isArray(body.variants) ? body.variants : []
    let updatedVariants = 0

    for (const variant of variants) {
      const variantId = String(variant?.id || '').trim()
      if (!variantId) continue

      const { error } = await admin
        .from('product_variants')
        .update({ stock_multiplier: normalizeStockMultiplier(variant.stockMultiplier), updated_at: now })
        .eq('id', variantId)
        .eq('product_id', productId)
        .eq('store_id', storeId)

      if (error) throw error
      updatedVariants += 1
    }

    return NextResponse.json({ ok: true, stockTrackingMode, updatedVariants })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'VARIANT_STOCK_CONFIGURE_FAILED'
    console.error('[youcan][variants][configure] failed', { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * Liste les produits du store dont la configuration stock/variantes n'a pas encore
 * été confirmée (import YouCan "Plus tard" ou configuration interrompue).
 */
export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const storeId = String(new URL(request.url).searchParams.get('storeId') || '').trim()

    if (!storeId) {
      return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    }

    await verifyStoreAccess(supabase, user.id, storeId)

    const admin = createAdminClient()

    const { data: products, error: productsError } = await admin
      .from('products')
      .select('id, name, stock_tracking_mode')
      .eq('store_id', storeId)
      .is('stock_setup_confirmed_at', null)
      .order('created_at', { ascending: false })

    if (productsError) throw productsError

    const productIds = (products || []).map((product: any) => String(product.id))
    if (productIds.length === 0) {
      return NextResponse.json({ pendingVariantSetup: [] })
    }

    // Uniquement les produits réellement importés depuis YouCan.
    const { data: youcanMappings, error: mappingsError } = await admin
      .from('youcan_entity_mappings')
      .select('internal_id')
      .eq('store_id', storeId)
      .eq('entity_type', 'product')

    if (mappingsError) throw mappingsError

    const youcanProductIds = new Set(
      (youcanMappings || [])
        .map((row: any) => String(row.internal_id || ''))
        .filter(Boolean)
    )

    const scopedProductIds = productIds.filter((id) => youcanProductIds.has(id))
    if (scopedProductIds.length === 0) {
      return NextResponse.json({ pendingVariantSetup: [] })
    }

    const { data: variants, error: variantsError } = await admin
      .from('product_variants')
      .select('id, product_id, name, sku, selling_price, stock_multiplier')
      .eq('store_id', storeId)
      .in('product_id', scopedProductIds)
      .order('selling_price', { ascending: true })

    if (variantsError) throw variantsError

    const grouped = new Map<string, Array<Record<string, unknown>>>()
    ;(variants || []).forEach((variant: any) => {
      const productKey = String(variant.product_id)
      if (!grouped.has(productKey)) grouped.set(productKey, [])
      grouped.get(productKey)!.push({
        id: String(variant.id),
        name: String(variant.name || ''),
        sku: String(variant.sku || ''),
        sellingPrice: Number(variant.selling_price || 0),
        stockMultiplier: Number(variant.stock_multiplier || 1),
      })
    })

    const pendingVariantSetup = (products || [])
      .filter((product: any) => youcanProductIds.has(String(product.id)))
      .map((product: any) => ({
        productId: String(product.id),
        productName: String(product.name || ''),
        stockTrackingMode: product.stock_tracking_mode === 'shared' ? 'shared' : 'variant',
        variants: grouped.get(String(product.id)) || [],
      }))
      .filter((entry) => entry.variants.length >= 2)

    return NextResponse.json({ pendingVariantSetup })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'VARIANT_STOCK_PENDING_FAILED'
    console.error('[youcan][variants][pending] failed', { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
