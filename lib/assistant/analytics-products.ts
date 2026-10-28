/**
 * Sections produits, commandes récentes, livraison et stock.
 *
 * - produits : agrégat exécuté en base, liste bornée par définition ;
 * - livraison et stock : aucune source autorisée ⇒ `unavailable` explicite,
 *   jamais un agrégat approximatif (propositions SQL non exécutées).
 */
import {
  allStoresFull,
  authorizedStoreIds,
  baseMeta,
  forbidden,
  invalidPayload,
  singleCurrency,
  toDecimalText,
  toNumber,
  unavailable,
  v5Value,
  type SectionRequest,
  type SectionResult,
} from '@/lib/assistant/analytics-contract'
import { compareDecimals, sumDecimals } from '@/lib/assistant/analytics-decimal'
import {
  assertBusinessRange,
  rangeInstants,
  SECTION_MAX_DAYS,
} from '@/lib/assistant/analytics-range'
import { TopProductRowSchema, validateRows } from '@/lib/assistant/analytics-rpc-validation'

export interface ProductPerformanceRow {
  productId: string | null
  productName: string
  quantity: number | null
  revenue: string | null
  /** `null` = non autorisé (accès commercial) ou non calculable. Jamais zéro. */
  profit: string | null
}

/**
 * Classement produits : `rpc_dashboard_top_products` agrège les lignes des
 * commandes livrées et ne publie `profit` qu'aux périmètres entièrement `full`.
 * La liste est bornée **par définition** : elle n'est jamais présentée comme un
 * total de CA, et le CA classé est contrôlé contre le V5.
 */
export async function readProductSection(
  { supabase, kpis }: SectionRequest,
  limit = 5,
): Promise<SectionResult<ProductPerformanceRow>> {
  const source = 'rpc_dashboard_top_products'
  if (kpis.state === 'forbidden') return forbidden('products', source, kpis)
  const storeIds = authorizedStoreIds(kpis)
  if (storeIds.length === 0) return unavailable('products', source, kpis, 'Aucune boutique autorisée.')
  if (!singleCurrency(kpis)) {
    return unavailable('products', source, kpis, 'Périmètre multidevise : aucun classement produit fusionné.')
  }

  try {
    assertBusinessRange(kpis.range, SECTION_MAX_DAYS)
  } catch {
    return unavailable('products', source, kpis, `Période trop large pour un classement produits (maximum ${SECTION_MAX_DAYS} jours).`)
  }

  const { startUtc, endUtc } = rangeInstants(kpis.range)
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

  const validated = validateRows(TopProductRowSchema, data)
  if (!validated.ok) return invalidPayload('products', source, kpis, validated.issues)

  const canSeeMoney = allStoresFull(kpis)
  const rows: ProductPerformanceRow[] = validated.rows.map((row) => ({
    productId: row.product_id,
    productName: row.product_name ?? 'Produit sans nom',
    quantity: toNumber(row.total_quantity),
    revenue: toDecimalText(row.total_revenue),
    profit: canSeeMoney ? toDecimalText(row.profit) : null,
  }))

  const meta = baseMeta('products', source, kpis, rows.length === 0 ? 'empty' : 'complete')
  meta.limits.push(`Classement limité aux ${boundedLimit} premiers produits : la somme n’est pas le CA total.`)
  meta.limits.push('Profit produit = ventes − coût d’achat ; hors publicité, livraison et confirmation.')
  if (!canSeeMoney) meta.notices.push('Profit masqué : accès financier `full` requis sur toutes les boutiques.')

  if (canSeeMoney && rows.some((row) => row.profit === null)) {
    meta.state = 'partial'
    meta.notices.push('Au moins un produit n’a pas de coût d’achat exploitable : profit non calculable.')
  }
  if (rows.some((row) => row.quantity === null)) {
    meta.state = 'partial'
    meta.notices.push('Quantité absente pour au moins un produit : aucune valeur n’est remplacée par zéro.')
  }

  const rankedRevenue = sumDecimals(rows.map((row) => row.revenue))
  const totalRevenue = v5Value(kpis, 'revenue')

  // Le classement est un sous-ensemble : seul un dépassement est incohérent.
  const exceeded = rankedRevenue !== null && totalRevenue !== null
    ? compareDecimals(rankedRevenue, totalRevenue) === 1
    : false

  meta.consistency = [
    {
      metric: 'products.ranked_revenue',
      v5: totalRevenue,
      section: rankedRevenue,
      match: exceeded ? false : null,
      reason: exceeded ? 'EXCEEDS_SCOPE' : 'SUBSET_EXPECTED',
    },
  ]
  if (exceeded) {
    if (meta.state === 'complete') meta.state = 'partial'
    meta.notices.push('Le CA classé dépasse le CA V5 de la période : incohérence signalée.')
  }

  const quantities = rows.map((row) => row.quantity)
  const quantityTotal = quantities.every((value): value is number => value !== null)
    ? quantities.reduce((sum, value) => sum + value, 0)
    : null

  return {
    meta,
    rows,
    totals: {
      rankedProducts: rows.length,
      rankedRevenue,
      quantity: quantityTotal,
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
 * Dernières commandes : lecture unitaire bornée, `[from, to[`, sans agrégation
 * ni montant additionné. L'identité du client n'est pas transmise.
 */
export async function readRecentOrdersSection(
  { supabase, kpis }: SectionRequest,
  limit = 8,
): Promise<SectionResult<RecentOrderRow>> {
  const source = 'orders:limit'
  if (kpis.state === 'forbidden') return forbidden('recent_orders', source, kpis)
  const storeIds = authorizedStoreIds(kpis)
  if (storeIds.length === 0) return unavailable('recent_orders', source, kpis, 'Aucune boutique autorisée.')

  const { startUtc, endUtc } = rangeInstants(kpis.range)
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
  if (!Array.isArray(data)) return invalidPayload('recent_orders', source, kpis, ['Réponse non tabulaire.'])

  const rows: RecentOrderRow[] = []
  for (const raw of data as Array<Record<string, unknown>>) {
    if (typeof raw.id !== 'string') return invalidPayload('recent_orders', source, kpis, ['Identifiant de commande absent.'])
    rows.push({
      id: raw.id,
      storeId: typeof raw.store_id === 'string' ? raw.store_id : '',
      status: typeof raw.status === 'string' ? raw.status : null,
      orderDate: typeof raw.order_date === 'string' ? raw.order_date : null,
      total: toDecimalText(raw.total_selling_price),
      city: typeof raw.city === 'string' ? raw.city : null,
    })
  }

  const meta = baseMeta('recent_orders', source, kpis, rows.length === 0 ? 'empty' : 'complete')
  meta.limits.push(`Échantillon borné à ${boundedLimit} commandes ; identité client non transmise.`)
  return { meta, rows, totals: { sampleSize: rows.length } }
}

/**
 * Livraison : aucune RPC agrégée par transporteur n'existe. La proposition
 * (`docs/assistant-analytics-lot2-rpc-proposals.sql`) n'est pas exécutée.
 */
export function readDeliverySection({ kpis }: SectionRequest): SectionResult<never> {
  return unavailable(
    'delivery',
    'rpc_assistant_delivery_performance (proposée, non exécutée)',
    kpis,
    'Performance par transporteur non disponible : aucun agrégat autorisé n’existe.',
  )
}

/**
 * Stock : le stock exact exige l'agrégat par produit ET variante (sens des
 * ajustements, multiplicateur, variantes sans mouvement). Aucune fonction
 * autorisée ne l'expose ; `rpc_public_catalog_stock_snapshot` est réservée au
 * backend et ne vérifie pas l'appartenance.
 */
export function readStockSection({ kpis }: SectionRequest): SectionResult<never> {
  return unavailable(
    'stock',
    'rpc_assistant_stock_snapshot (proposée, non exécutée)',
    kpis,
    'Stock par variante non disponible : aucun agrégat autorisé n’existe.',
  )
}
