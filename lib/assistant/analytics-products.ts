/**
 * Sections produits, commandes récentes, livraison et stock.
 *
 * Les agrégats produits sont exécutés en base (`rpc_dashboard_top_products`) ;
 * la livraison et le stock n'ont aucune fonction autorisée et restent
 * explicitement `unavailable` jusqu'à validation des propositions SQL de
 * `docs/assistant-analytics-lot2-rpc-proposals.sql` (non exécutées).
 */
import {
  allStoresFull,
  authorizedStoreIds,
  baseMeta,
  forbidden,
  instants,
  singleCurrency,
  toDecimalText,
  toNumber,
  unavailable,
  type SectionRequest,
  type SectionResult,
} from '@/lib/assistant/analytics-contract'
interface ProductRow {
  product_id: string | null
  product_name: string | null
  total_quantity: number | string | null
  total_revenue: string | number | null
  profit: string | number | null
}

export interface ProductPerformanceRow {
  productId: string | null
  productName: string
  quantity: number
  revenue: string | null
  /** `null` = non autorisé (accès commercial) ou non calculable. Jamais zéro inventé. */
  profit: string | null
}

/**
 * Produits : `rpc_dashboard_top_products` agrège en base les lignes des
 * commandes livrées et n'expose `profit` qu'aux périmètres entièrement `full`
 * (`dashboard_legacy_access`). Liste bornée à `p_limit` : elle n'est jamais
 * présentée comme un total de CA.
 */
export async function readProductSection(
  { supabase, kpis }: SectionRequest,
  limit = 5,
): Promise<SectionResult<ProductPerformanceRow>> {
  const source = 'rpc_dashboard_top_products'
  if (kpis.state === 'forbidden') return forbidden('products', source, kpis)
  const storeIds = authorizedStoreIds(kpis)
  if (storeIds.length === 0) return unavailable('products', source, kpis, 'Aucune boutique autorisée dans le périmètre.')
  if (!singleCurrency(kpis)) {
    return unavailable('products', source, kpis, 'Périmètre multidevise : aucun classement produit fusionné.')
  }

  const { startUtc, endUtc } = instants(kpis.range)
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 10)
  const { data, error } = await supabase.rpc(source, {
    p_store_ids: storeIds,
    p_start_date: startUtc,
    p_end_date: endUtc,
    p_limit: boundedLimit,
  })
  if (error) {
    if (error.message?.includes('NO_ACCESS')) return forbidden('products', source, kpis)
    return unavailable('products', source, kpis, 'Lecture du classement produit indisponible.')
  }

  const rows = (Array.isArray(data) ? data : []) as ProductRow[]
  const canSeeMoney = allStoresFull(kpis)
  const mapped: ProductPerformanceRow[] = rows.map((row) => ({
    productId: row.product_id ?? null,
    productName: row.product_name ?? 'Produit sans nom',
    quantity: toNumber(row.total_quantity) ?? 0,
    revenue: toDecimalText(row.total_revenue),
    profit: canSeeMoney ? toDecimalText(row.profit) : null,
  }))

  const meta = baseMeta('products', source, kpis, mapped.length === 0 ? 'empty' : 'complete')
  meta.limits.push(`Classement limité aux ${boundedLimit} premiers produits : la somme n’est pas le CA total.`)
  meta.limits.push('Profit produit = ventes − coût d’achat ; hors publicité, livraison et confirmation.')
  if (!canSeeMoney) meta.notices.push('Profit masqué : accès financier `full` requis sur toutes les boutiques.')
  if (canSeeMoney && mapped.some((row) => row.profit === null)) {
    meta.state = 'partial'
    meta.notices.push('Au moins un produit n’a pas de coût d’achat exploitable : profit non calculable.')
  }

  return {
    meta,
    rows: mapped,
    totals: {
      quantity: mapped.reduce((sum, row) => sum + row.quantity, 0),
      rankedProducts: mapped.length,
    },
  }
}


export interface RecentOrderRow {
  id: string
  storeId: string
  status: string | null
  orderDate: string | null
  total: string | null
  city: string | null
}

/**
 * Dernières commandes : lecture unitaire bornée (aucune agrégation, aucun
 * montant additionné). L'identité du client n'est pas renvoyée.
 */
export async function readRecentOrdersSection(
  { supabase, kpis }: SectionRequest,
  limit = 8,
): Promise<SectionResult<RecentOrderRow>> {
  const source = 'orders:limit'
  if (kpis.state === 'forbidden') return forbidden('recent_orders', source, kpis)
  const storeIds = authorizedStoreIds(kpis)
  if (storeIds.length === 0) {
    return unavailable('recent_orders', source, kpis, 'Aucune boutique autorisée dans le périmètre.')
  }

  const { startUtc, endUtc } = instants(kpis.range)
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 20)
  const { data, error } = await supabase
    .from('orders')
    .select('id, store_id, status, order_date, total_selling_price, city')
    .in('store_id', storeIds)
    .gte('order_date', startUtc)
    .lt('order_date', endUtc)
    .order('order_date', { ascending: false })
    .limit(boundedLimit)

  if (error) return unavailable('recent_orders', source, kpis, 'Lecture des dernières commandes indisponible.')

  const rows = (data ?? []) as Array<{
    id: string
    store_id: string | null
    status: string | null
    order_date: string | null
    total_selling_price: string | number | null
    city: string | null
  }>

  const mapped: RecentOrderRow[] = rows.map((row) => ({
    id: row.id,
    storeId: row.store_id ?? '',
    status: row.status,
    orderDate: row.order_date,
    total: toDecimalText(row.total_selling_price),
    city: row.city,
  }))

  const meta = baseMeta('recent_orders', source, kpis, mapped.length === 0 ? 'empty' : 'complete')
  meta.limits.push(`Échantillon borné à ${boundedLimit} commandes ; identité client non transmise.`)
  return { meta, rows: mapped, totals: { sampleSize: mapped.length } }
}

/**
 * Livraison : aucune RPC agrégée par transporteur n'existe. Les anciennes
 * lectures visaient `delivery_company` (colonne inexistante : le schéma porte
 * `delivery_company_id`) sur une liste plafonnée. La fonction proposée figure
 * dans `docs/assistant-analytics-lot2-rpc-proposals.sql` (non exécutée).
 */
export function readDeliverySection({ kpis }: SectionRequest): SectionResult<never> {
  return unavailable(
    'delivery',
    'rpc_dashboard_delivery_performance (à créer)',
    kpis,
    'Performance par transporteur non disponible : RPC agrégée dédiée en attente de validation.',
  )
}

/**
 * Stock : le stock exact exige l'agrégat par produit ET variante avec
 * `adjustment_direction` et `stock_multiplier`. Aucune fonction autorisée ne
 * l'expose (la RPC catalogue est réservée au service_role et ne vérifie pas
 * l'appartenance à la boutique). Proposition non exécutée :
 * `rpc_assistant_stock_snapshot`.
 */
export function readStockSection({ kpis }: SectionRequest): SectionResult<never> {
  return unavailable(
    'stock',
    'rpc_assistant_stock_snapshot (à créer)',
    kpis,
    'Stock par variante non disponible : RPC dédiée en attente de validation.',
  )
}
