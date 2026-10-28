/**
 * Bornes temporelles du moteur analytique.
 *
 * Toutes les périodes sont des journées métier `[from, to[` (borne haute
 * exclue), converties en instants UTC par le calendrier métier existant
 * (`lib/dashboard/business-time.ts`), jamais par le fuseau du serveur.
 */
import type { AnalyticsRange } from '@/lib/assistant/types'
import {
  addBusinessDays,
  businessDayStartUtc,
  businessRange,
  businessTodayIso,
  type BusinessRange,
} from '@/lib/dashboard/business-time'

/** Plage maximale acceptée par `rpc_dashboard_kpi_reader` (contrat V5). */
export const KPI_MAX_DAYS = 400
/** Plage maximale d'une section détaillée : au-delà, réponse `unavailable`. */
export const SECTION_MAX_DAYS = 90
/** Boutiques maximales par analyse (coût et devises). */
export const MAX_SCOPE_STORES = 5
/** Groupes détaillés maximaux renvoyés à l'assistant (agents, villes). */
export const MAX_DETAIL_GROUPS = 200

const DAY_MS = 86_400_000

export function isValidBusinessDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const parsed = new Date(`${day}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day
}

export function businessDayCount(range: BusinessRange): number {
  return (Date.parse(range.to) - Date.parse(range.from)) / DAY_MS
}

/**
 * Valide une période métier et applique la borne maximale demandée.
 * Lève `ANALYTICS_BAD_RANGE` : aucune période n'est jamais tronquée en silence.
 */
export function assertBusinessRange(range: BusinessRange, maxDays = KPI_MAX_DAYS): BusinessRange {
  if (!isValidBusinessDay(range.from) || !isValidBusinessDay(range.to)) {
    throw new Error('ANALYTICS_BAD_RANGE')
  }
  if (range.from >= range.to) throw new Error('ANALYTICS_BAD_RANGE')
  if (businessDayCount(range) > maxDays) throw new Error('ANALYTICS_RANGE_TOO_LARGE')
  return range
}

/**
 * Résout une période de question en journées métier.
 *
 * Les plages absolues peuvent être fournies :
 * - en journées `YYYY-MM-DD` (chemin recommandé) ;
 * - en instants ISO correspondant exactement à minuit métier (compatibilité
 *   avec l'ancien format `{ start, end }`).
 */
export function resolveAssistantBusinessRange(range: AnalyticsRange, now = new Date()): BusinessRange {
  const today = businessTodayIso(now)

  if (typeof range === 'object') {
    if (isValidBusinessDay(range.start) && isValidBusinessDay(range.end)) {
      return assertBusinessRange({ from: range.start, to: range.end })
    }

    const start = new Date(range.start)
    const end = new Date(range.end)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      throw new Error('ANALYTICS_BAD_RANGE')
    }

    const from = businessTodayIso(start)
    const to = businessTodayIso(end)
    if (
      businessDayStartUtc(from).getTime() !== start.getTime() ||
      businessDayStartUtc(to).getTime() !== end.getTime()
    ) {
      throw new Error('ANALYTICS_BAD_RANGE')
    }
    return assertBusinessRange({ from, to })
  }

  if (range === 'yesterday') return assertBusinessRange(businessRange('yesterday', null, null, now))
  if (range === 'month' || range === 'last_month') {
    return assertBusinessRange(businessRange(range, null, null, now))
  }

  const days = range === '7d' ? 7 : 30
  return assertBusinessRange({ from: addBusinessDays(today, 1 - days), to: addBusinessDays(today, 1) })
}

/** Instants UTC d'une période `[from, to[` (borne haute exclue). */
export function rangeInstants(range: BusinessRange): { startUtc: string; endUtc: string } {
  const start = businessDayStartUtc(range.from)
  const end = businessDayStartUtc(range.to)
  return { startUtc: start.toISOString(), endUtc: end.toISOString() }
}

/**
 * Convertit une borne haute exclue en borne haute inclusive, à la précision
 * `timestamptz` de PostgreSQL (microseconde).
 *
 * Certaines RPC historiques comparent `order_date <= p_end_date`. Leur passer
 * `end − 1 ms` perdrait les 999 dernières microsecondes de la journée : on
 * passe donc la dernière microseconde réellement incluse (`...999999Z`).
 */
export function exclusiveEndAsInclusiveMicrosecond(endUtcIso: string): string {
  const endMs = Date.parse(endUtcIso)
  if (!Number.isFinite(endMs)) throw new Error('ANALYTICS_BAD_RANGE')

  const lastMillisecond = new Date(endMs - 1).toISOString()
  if (!lastMillisecond.endsWith('Z')) throw new Error('ANALYTICS_BAD_RANGE')

  // `...:59.999Z` -> `...:59.999999Z` (dernière microseconde de cette ms).
  return `${lastMillisecond.slice(0, -1)}999Z`
}
