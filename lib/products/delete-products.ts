import { deleteManagedProductImages } from '@/lib/products/product-images'

type SupabaseLike = any

export type ProductDeletionReason = 'IN_SALES' | 'HAS_STOCK_MOVEMENTS' | 'NOT_FOUND'

export type ProductDeletionReportItem = {
  id: string
  name: string | null
  deletable: boolean
  reasons: ProductDeletionReason[]
  in_sales: number
  stock_movements: number
  purchases: number
  /** Provenance : intégrations qui référencent ce produit (jamais un droit de suppression). */
  sources: string[]
}

export type ProductDeletionTotals = {
  selected: number
  deletable: number
  blocked_in_sales: number
  blocked_in_stock: number
}

export type ProductDeletionReport = {
  items: ProductDeletionReportItem[]
  totals: ProductDeletionTotals
}

const EMPTY_TOTALS: ProductDeletionTotals = {
  selected: 0,
  deletable: 0,
  blocked_in_sales: 0,
  blocked_in_stock: 0,
}

const REASON_LABELS: Record<ProductDeletionReason, string> = {
  IN_SALES: 'utilisé dans des ventes',
  HAS_STOCK_MOVEMENTS: 'lié à des mouvements de stock',
  NOT_FOUND: 'introuvable',
}

const SOURCE_LABELS: Record<string, string> = {
  lightfunnels: 'Lightfunnels',
  youcan: 'YouCan',
  facebook: 'Facebook Ads',
}

export function formatDeletionReasons(reasons: Array<ProductDeletionReason | string> | undefined) {
  return (reasons || [])
    .map((reason) => REASON_LABELS[reason as ProductDeletionReason] || String(reason))
    .join(', ')
}

/** Provenance lisible d'un produit importé (indication, jamais une autorisation). */
export function formatDeletionSources(sources: string[] | undefined) {
  return (sources || []).map((source) => SOURCE_LABELS[source] || source).join(', ')
}

/**
 * Rapport de suppression d'un lot de produits. Lecture seule : il indique ce qui est
 * supprimable, ce qui est bloqué (ventes, mouvements de stock) et par quelle intégration le
 * produit est référencé. Le contrôle est fait en base, dans la même logique que la
 * suppression elle-même — l'interface ne décide donc plus seule.
 */
export async function fetchProductDeletionReport(params: {
  supabase: SupabaseLike
  storeId: string
  productIds: string[]
}): Promise<ProductDeletionReport> {
  const ids = Array.from(new Set((params.productIds || []).filter(Boolean)))

  if (!params.storeId || ids.length === 0) {
    return { items: [], totals: EMPTY_TOTALS }
  }

  const { data, error } = await params.supabase.rpc('rpc_products_deletion_report', {
    p_store_id: params.storeId,
    p_product_ids: ids,
  })

  if (error) throw error

  const payload = (data || {}) as Partial<ProductDeletionReport>

  return {
    items: payload.items || [],
    totals: payload.totals || { ...EMPTY_TOTALS, selected: ids.length },
  }
}

/**
 * Texte de confirmation : dit précisément ce qui sera supprimé et ce qui restera, avec le
 * motif. Un produit lié à des ventes n'est **jamais** supprimé pour laisser l'historique
 * intact : l'utilisateur est orienté vers l'archivage.
 */
export function describeProductDeletion(report: ProductDeletionReport) {
  const { totals } = report
  const blocked = report.items.filter((item) => !item.deletable)

  const lines = [`Sélection : ${totals.selected} produit(s).`]
  lines.push(`• ${totals.deletable} supprimable(s) sans dépendance`)

  if (totals.blocked_in_sales > 0) {
    lines.push(`• ${totals.blocked_in_sales} utilisé(s) dans des ventes — conservé(s) pour l’historique`)
  }

  if (totals.blocked_in_stock > 0) {
    lines.push(`• ${totals.blocked_in_stock} lié(s) à des entrées de stock — conservé(s)`)
  }

  if (blocked.length > 0 && blocked.length <= 5) {
    lines.push('')
    for (const item of blocked) {
      lines.push(`– ${item.name || item.id} : ${formatDeletionReasons(item.reasons)}`)
    }
  }

  // Provenance informative : la suppression est locale à Jisra et ne touche jamais la
  // boutique distante — un mapping n'autorise d'ailleurs jamais une purge automatique.
  const sources = Array.from(new Set(report.items.flatMap((item) => item.sources || [])))

  if (sources.length > 0) {
    lines.push('')
    lines.push(`Provenance : ${formatDeletionSources(sources)} — la boutique distante n'est jamais modifiée.`)
  }

  lines.push('')
  lines.push(
    totals.deletable > 0
      ? 'Confirmer la suppression des seuls produits supprimables ? Les autres seront ignorés.'
      : 'Aucun produit ne peut être supprimé. Utilisez « Archiver » pour retirer de la vente en conservant l’historique.'
  )

  return lines.join('\n')
}

/**
 * Suppression sûre : le rapport est établi, seuls les produits sans dépendance sont
 * supprimés (transaction en base), puis les fichiers d'images réellement libérés sont
 * retirés du Storage. Aucun appel n'est fait vers un fournisseur externe.
 */
export async function deleteProductsSafely(params: {
  supabase: SupabaseLike
  storeId: string
  productIds: string[]
}): Promise<{
  deletedCount: number
  deletedIds: string[]
  blocked: Array<{ id: string; name: string | null; reasons: string[] }>
  totals: ProductDeletionTotals
}> {
  const report = await fetchProductDeletionReport(params)
  const deletableIds = report.items.filter((item) => item.deletable).map((item) => item.id)

  const blocked = report.items
    .filter((item) => !item.deletable)
    .map((item) => ({ id: item.id, name: item.name, reasons: item.reasons as string[] }))

  if (deletableIds.length === 0) {
    return { deletedCount: 0, deletedIds: [], blocked, totals: report.totals }
  }

  // Les URLs des images sont lues **avant** la suppression : les lignes partent en cascade
  // avec le produit, et les fichiers du Storage doivent ensuite être retirés nommément.
  const { data: imageRows, error: imageError } = await params.supabase
    .from('product_images')
    .select('image_url')
    .in('product_id', deletableIds)

  if (imageError) throw imageError

  const { data, error } = await params.supabase.rpc('rpc_delete_products', {
    p_store_id: params.storeId,
    p_product_ids: deletableIds,
  })

  if (error) throw error

  const payload = (data || {}) as {
    deleted?: string[]
    deletedCount?: number
    blocked?: Array<{ id: string; name: string | null; reasons: string[] }>
  }

  await deleteManagedProductImages({
    supabase: params.supabase,
    imageUrls: ((imageRows || []) as Array<{ image_url: string | null }>).map((row) => row.image_url),
  })

  return {
    deletedCount: Number(payload.deletedCount || 0),
    deletedIds: Array.isArray(payload.deleted) ? payload.deleted : [],
    blocked: [...blocked, ...(payload.blocked || [])],
    totals: report.totals,
  }
}
