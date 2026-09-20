import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeStockMultiplier } from '@/lib/integrations/variant-stock'

/**
 * Stock réel d'un store, agrégé depuis les mouvements d'inventaire.
 * - productStock : stock physique total par produit (variantes + non affecté)
 * - variantStock : stock physique par variante
 */
export type StoreStockSnapshot = {
  productStock: Record<string, number>
  variantStock: Record<string, number>
}

type StockRow = {
  product_id: string | null
  product_variant_id: string | null
  quantity: number | string | null
}

const MOVEMENT_COLUMNS = 'product_id, product_variant_id, movement_type, adjustment_direction, quantity'
const CHUNK_SIZE = 200

/** Agrégation SQL : utilisée en priorité, évite de rapatrier tous les mouvements. */
async function fetchStockRowsViaRpc(storeId: string, productIds: string[]): Promise<StockRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('rpc_public_catalog_stock_snapshot', {
    p_store_id: storeId,
    p_product_ids: productIds,
  })

  if (error) throw error
  return (data || []) as StockRow[]
}

/** Repli si la fonction SQL n'est pas encore disponible dans l'environnement. */
async function fetchStockRowsViaMovements(storeId: string, productIds: string[]): Promise<StockRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('inventory_movements')
    .select(MOVEMENT_COLUMNS)
    .eq('store_id', storeId)
    .in('product_id', productIds)

  if (error) throw error

  return ((data || []) as Array<Record<string, unknown>>).map((movement) => ({
    product_id: (movement.product_id as string) || null,
    product_variant_id: (movement.product_variant_id as string) || null,
    quantity: resolveMovementDelta({
      product_id: (movement.product_id as string) || null,
      product_variant_id: (movement.product_variant_id as string) || null,
      movement_type: (movement.movement_type as string) || null,
      adjustment_direction: (movement.adjustment_direction as string) || null,
      quantity: Number(movement.quantity || 0),
    }),
  }))
}

type MovementRow = {
  product_id: string | null
  product_variant_id: string | null
  movement_type: string | null
  adjustment_direction: string | null
  quantity: number | null
}

export function resolveMovementDelta(movement: MovementRow): number {
  const quantity = Number(movement.quantity || 0)

  if (movement.movement_type === 'in') return quantity
  if (movement.movement_type === 'out') return -quantity

  if (movement.movement_type === 'adjustment') {
    return movement.adjustment_direction === 'out' ? -quantity : quantity
  }

  return 0
}

export async function computeStoreStock(
  storeId: string,
  productIds: string[]
): Promise<StoreStockSnapshot> {
  const productStock: Record<string, number> = {}
  const variantStock: Record<string, number> = {}
  const ids = Array.from(new Set(productIds.map((id) => String(id || '')).filter(Boolean)))

  if (ids.length === 0) {
    return { productStock, variantStock }
  }

  let useFallback = false

  for (let index = 0; index < ids.length; index += CHUNK_SIZE) {
    const chunk = ids.slice(index, index + CHUNK_SIZE)

    const rows = useFallback
      ? await fetchStockRowsViaMovements(storeId, chunk)
      : await fetchStockRowsViaRpc(storeId, chunk).catch((error) => {
          console.error('[CATALOG_STOCK_RPC_FALLBACK]', error)
          useFallback = true
          return fetchStockRowsViaMovements(storeId, chunk)
        })

    for (const row of rows) {
      const productId = String(row.product_id || '')
      if (!productId) continue

      const delta = Number(row.quantity || 0)
      productStock[productId] = (productStock[productId] || 0) + delta

      const variantId = String(row.product_variant_id || '')
      if (variantId) {
        variantStock[variantId] = (variantStock[variantId] || 0) + delta
      }
    }
  }

  return { productStock, variantStock }
}

/**
 * Unités réellement vendables pour une variante.
 * - Mode `shared` : stock unique du produit / multiplicateur de la variante.
 * - Mode `variant` : stock propre à la variante.
 */
export function resolveVariantAvailableStock(params: {
  stockTrackingMode: string | null
  productStock: number
  variantStock: number
  stockMultiplier: number
}): number {
  const safeProductStock = Math.max(Number(params.productStock || 0), 0)

  if (String(params.stockTrackingMode || 'variant') === 'shared') {
    const multiplier = normalizeStockMultiplier(params.stockMultiplier)
    return Math.floor(safeProductStock / multiplier)
  }

  return Math.max(Number(params.variantStock || 0), 0)
}

export async function getStoreCurrency(storeId: string): Promise<string> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('stores').select('currency').eq('id', storeId).maybeSingle()
  return String(data?.currency || 'MAD').toUpperCase()
}

