import { normalizeStockMultiplier } from '@/lib/integrations/variant-stock'

type SupabaseLike = any

export type VariantSyncInput = {
  id?: string | null
  name: string
  sku: string
  selling_price: number
  purchase_cost: number
  stock_multiplier: number
  option_values: Record<string, string>
}

/**
 * Synchronise les variantes d'un produit SANS supprimer/recréer les lignes existantes.
 * Objectif : conserver les IDs, les mappings YouCan et les liens vers les commandes.
 * - variante avec `id` existant  -> update
 * - variante avec SKU existant   -> update (rattachement)
 * - nouvelle variante            -> insert
 * - variante absente de la liste -> delete (suppression volontaire)
 */
export async function syncProductVariants(params: {
  supabase: SupabaseLike
  storeId: string
  productId: string
  variants: VariantSyncInput[]
}) {
  const { supabase, storeId, productId, variants } = params
  const now = new Date().toISOString()

  const { data: existingRows, error: existingError } = await supabase
    .from('product_variants')
    .select('id, sku')
    .eq('product_id', productId)

  if (existingError) throw existingError

  const existingById = new Map<string, any>(
    (existingRows || []).map((row: any) => [String(row.id), row])
  )
  const existingBySku = new Map<string, any>(
    (existingRows || []).map((row: any) => [String(row.sku || ''), row])
  )

  const keptIds = new Set<string>()

  for (const variant of variants) {
    const payload = {
      store_id: storeId,
      product_id: productId,
      name: variant.name,
      sku: variant.sku,
      selling_price: Number.isFinite(variant.selling_price) ? variant.selling_price : 0,
      purchase_cost: Number.isFinite(variant.purchase_cost) ? variant.purchase_cost : 0,
      stock_multiplier: normalizeStockMultiplier(variant.stock_multiplier),
      option_values: variant.option_values || {},
      updated_at: now,
    }

    const targetId = variant.id && existingById.has(String(variant.id)) ? String(variant.id) : null
    const skuMatch = !targetId && variant.sku ? existingBySku.get(variant.sku) : undefined
    const resolvedId = targetId || (skuMatch?.id ? String(skuMatch.id) : null)

    if (resolvedId) {
      const { error } = await supabase
        .from('product_variants')
        .update(payload)
        .eq('id', resolvedId)

      if (error) throw error
      keptIds.add(resolvedId)
      continue
    }

    const { data: inserted, error: insertError } = await supabase
      .from('product_variants')
      .insert(payload)
      .select('id')
      .single()

    if (insertError) throw insertError
    keptIds.add(String(inserted.id))
  }

  const removedIds = (existingRows || [])
    .map((row: any) => String(row.id))
    .filter((id: string) => !keptIds.has(id))

  if (removedIds.length > 0) {
    const { error: deleteError } = await supabase
      .from('product_variants')
      .delete()
      .in('id', removedIds)

    if (deleteError) throw deleteError
  }

  return { keptIds: Array.from(keptIds), removedIds }
}
