/**
 * Séries des graphiques du Dashboard construites à partir des points du
 * lecteur KPI V5.
 *
 * Objectif : retrouver exactement les règles de présentation du dashboard
 * d'origine (granularité, fenêtre, buckets vides) tout en gardant les agrégats
 * précalculés comme source de vérité.
 *
 * - les composantes additives sont regroupées **avant** tout ratio : CPL et CPA
 *   ne sont jamais la moyenne de ratios journaliers ;
 * - aucun montant n'est fabriqué : une journée absente du lecteur reste absente ;
 * - les seules journées exclues sont celles sans aucune composante affichable,
 *   comme dans le dashboard legacy.
 */
import type { KpiReaderPoint } from './kpi-reader'
import type { DashboardPeriod } from '@/lib/utils'

export type SeriesGranularity = 'day' | 'month'

export interface SeriesBucket {
  /** `YYYY-MM-DD` du début de bucket (jour, ou 1er du mois). */
  date: string
  orders_count: number
  delivered_count: number
  revenue: number
  ads: number
  purchase: number
  margin: number
}

function bucketKey(date: string, granularity: SeriesGranularity): string {
  return granularity === 'month' ? `${date.slice(0, 7)}-01` : date
}

function toNumber(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Regroupe les journées par bucket (jour ou mois) en additionnant les
 * composantes additives. `delivery` et `confirmation` ne sont pas exposés par
 * point dans le payload V5 : ils ne sont pas reconstitués ici.
 */
export function bucketPoints(
  points: KpiReaderPoint[],
  granularity: SeriesGranularity,
): SeriesBucket[] {
  const byKey = new Map<string, SeriesBucket>()

  for (const point of points) {
    const key = bucketKey(point.date, granularity)
    const bucket = byKey.get(key) ?? {
      date: key,
      orders_count: 0,
      delivered_count: 0,
      revenue: 0,
      ads: 0,
      purchase: 0,
      margin: 0,
    }
    bucket.orders_count += point.orders_count
    bucket.delivered_count += point.delivered_count
    bucket.revenue += toNumber(point.revenue)
    bucket.ads += toNumber(point.ads)
    bucket.purchase += toNumber(point.purchase_cost)
    bucket.margin += toNumber(point.contribution_margin)
    byKey.set(key, bucket)
  }

  return Array.from(byKey.values()).sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Le graphique de revenus legacy ne crée un point que pour une journée portant
 * au moins une commande (toutes statuts confondus), même si tous ses montants
 * sont nuls (commandes en attente ou annulées). Une journée sans commande
 * n'apparaît jamais. Cette règle est reproduite ici : la journée reste donc
 * visible avec ses zéros réels, elle n'est pas supprimée.
 */
export function hasOrders(bucket: SeriesBucket): boolean {
  return bucket.orders_count > 0
}

/** Graphique de revenus : seules les journées avec commande sont tracées. */
export function revenueSeries(
  points: KpiReaderPoint[],
  granularity: SeriesGranularity,
): SeriesBucket[] {
  return bucketPoints(points, granularity).filter(hasOrders)
}

/**
 * Graphique publicitaire : buckets vides conservés, sauf pour « Toujours » où
 * l'ancien dashboard ne gardait que les périodes avec activité réelle
 * (dépense, commande ou livraison).
 */
export function adsSeries(
  points: KpiReaderPoint[],
  granularity: SeriesGranularity,
  period: DashboardPeriod,
): SeriesBucket[] {
  const buckets = bucketPoints(points, granularity)
  if (period !== 'all') return buckets
  return buckets.filter(
    (bucket) => bucket.ads !== 0 || bucket.orders_count !== 0 || bucket.delivered_count !== 0,
  )
}

/** CPL / CPA recalculés sur les composantes déjà regroupées. */
export function bucketRatios(bucket: SeriesBucket): { cpl: number; cpa: number } {
  return {
    cpl: bucket.orders_count > 0 ? bucket.ads / bucket.orders_count : 0,
    cpa: bucket.delivered_count > 0 ? bucket.ads / bucket.delivered_count : 0,
  }
}
