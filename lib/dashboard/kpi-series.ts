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
 * - aucune journée n'est inventée hors de la fenêtre couverte : les journées
 *   antérieures à l'historique de la boutique restent absentes ;
 * - à l'intérieur de la fenêtre, toutes les journées existent, y compris celles
 *   sans donnée (zéros réels), comme sur le graphique CPL / CPA ;
 * - « Toujours » garde le filtre historique et n'affiche que les buckets avec
 *   activité réelle.
 */
import type { KpiReaderPoint } from './kpi-reader'
import { addBusinessDays } from './business-time'
import type { BusinessRange } from './business-time'
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

function nextMonthKey(key: string): string {
  const [year, month] = key.split('-').map(Number)
  const next = new Date(Date.UTC(year, month, 1))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function emptyBucket(date: string): SeriesBucket {
  return {
    date,
    orders_count: 0,
    delivered_count: 0,
    revenue: 0,
    ads: 0,
    purchase: 0,
    margin: 0,
  }
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
 * Visibilité d'un bucket sur le graphique de revenus.
 *
 * Règle historique conservée, sans invention :
 * - un bucket portant au moins une commande reste visible, même si tous ses
 *   montants sont nuls (commandes en attente, annulées ou non livrées) : un
 *   chiffre d'affaires à zéro n'est jamais un motif d'exclusion ;
 * - un bucket sans commande mais avec une activité financière affichable
 *   (dépense publicitaire seule, achat, marge) reste visible, comme dans le
 *   graphique legacy corrigé par P7.7 ;
 * - seuls les buckets entièrement vides sont écartés.
 */
export function hasRevenueActivity(bucket: SeriesBucket): boolean {
  return (
    bucket.orders_count > 0 ||
    bucket.delivered_count > 0 ||
    bucket.revenue !== 0 ||
    bucket.ads !== 0 ||
    bucket.purchase !== 0 ||
    bucket.margin !== 0
  )
}

/**
 * Complète la série sur toute la fenêtre calendaire : chaque journée (ou mois)
 * de `window` existe, y compris sans donnée, avec des zéros réels.
 *
 * Aucune journée antérieure à la fenêtre couverte n'est fabriquée : la borne
 * basse provient de `chartFillWindow` (historique de la boutique respecté).
 * Une période entièrement vide renvoie une série vide : l'état « Pas de
 * données » reste affiché, aucun mois nul n'est inventé.
 */
export function completeBuckets(
  points: KpiReaderPoint[],
  granularity: SeriesGranularity,
  window: BusinessRange | null,
): SeriesBucket[] {
  if (points.length === 0) return []
  const buckets = bucketPoints(points, granularity)
  if (!window) return buckets

  const byKey = new Map(buckets.map((bucket) => [bucket.date, bucket]))
  const completed: SeriesBucket[] = []

  if (granularity === 'month') {
    const startKey = bucketKey(window.from, 'month')
    const endKey = bucketKey(window.to, 'month')
    let key = startKey
    while (key <= endKey) {
      completed.push(byKey.get(key) ?? emptyBucket(key))
      key = nextMonthKey(key)
    }
    return completed
  }

  let day = window.from
  while (day <= window.to) {
    completed.push(byKey.get(day) ?? emptyBucket(day))
    day = addBusinessDays(day, 1)
  }
  return completed
}

/**
 * Graphique de revenus : toutes les journées de la période sont tracées, même
 * sans commande ni montant. « Toujours » conserve le filtre historique et ne
 * garde que les buckets avec commande ou activité financière (pas de série de
 * plusieurs centaines de journées vides).
 */
export function revenueSeries(
  points: KpiReaderPoint[],
  granularity: SeriesGranularity,
  period: DashboardPeriod,
  window: BusinessRange | null = null,
): SeriesBucket[] {
  if (period === 'all') return bucketPoints(points, granularity).filter(hasRevenueActivity)
  return completeBuckets(points, granularity, window)
}

/**
 * Graphique publicitaire : mêmes journées que le graphique de revenus, y
 * compris les journées sans dépense. « Toujours » conserve le filtre historique
 * (dépense, commande ou livraison réelle).
 */
export function adsSeries(
  points: KpiReaderPoint[],
  granularity: SeriesGranularity,
  period: DashboardPeriod,
  window: BusinessRange | null = null,
): SeriesBucket[] {
  if (period === 'all') {
    return bucketPoints(points, granularity).filter(
      (bucket) => bucket.ads !== 0 || bucket.orders_count !== 0 || bucket.delivered_count !== 0,
    )
  }
  return completeBuckets(points, granularity, window)
}

/** CPL / CPA recalculés sur les composantes déjà regroupées. */
export function bucketRatios(bucket: SeriesBucket): { cpl: number; cpa: number } {
  return {
    cpl: bucket.orders_count > 0 ? bucket.ads / bucket.orders_count : 0,
    cpa: bucket.delivered_count > 0 ? bucket.ads / bucket.delivered_count : 0,
  }
}
