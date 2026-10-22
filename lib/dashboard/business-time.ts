/**
 * Calendrier métier du Dashboard.
 *
 * Les journées sont calculées dans le fuseau métier (Africa/Casablanca par
 * défaut), jamais dans celui du navigateur. Les chaînes `YYYY-MM-DD` sont des
 * journées calendaires ; `businessRangeToInstants` les convertit en bornes UTC
 * pour les RPC legacy qui attendent des `timestamptz`.
 *
 * Le lecteur V5 reçoit directement des journées métier : aucune conversion
 * d'offset n'est nécessaire côté navigateur pour ce chemin.
 */
import type { DashboardPeriod } from '@/lib/utils'

export const BUSINESS_TIME_ZONE = 'Africa/Casablanca'
export const READER_ALL_DAYS = 365

export interface BusinessRange {
  /** Journée métier incluse, `YYYY-MM-DD`. */
  from: string
  /** Journée métier exclue, `YYYY-MM-DD`. */
  to: string
}

export interface BusinessDateParts {
  year: number
  month: number
  day: number
  /** 0 = dimanche … 6 = samedi, dans le fuseau métier. */
  weekday: number
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

/**
 * Transitions Africa/Casablanca épinglées sur tzdata 2026e.
 * `at` = instant UTC ; `offsetMinutes` = nouvel offset après la transition.
 * Le Maroc est à +00 avant 2018-10-28, puis +01 avec retours à +00 pendant
 * le Ramadan, et passe à +00 permanent le 2026-09-20 à 01:00 UTC.
 * Cette table rend le frontend indépendant de l'ICU du navigateur.
 */
const CASABLANCA_TRANSITIONS: Array<{ at: number; offsetMinutes: number }> = [
  { at: Date.UTC(2018, 9, 28, 3), offsetMinutes: 60 },
  { at: Date.UTC(2019, 4, 5, 2), offsetMinutes: 0 },
  { at: Date.UTC(2019, 5, 9, 2), offsetMinutes: 60 },
  { at: Date.UTC(2020, 3, 19, 2), offsetMinutes: 0 },
  { at: Date.UTC(2020, 4, 31, 2), offsetMinutes: 60 },
  { at: Date.UTC(2021, 3, 11, 2), offsetMinutes: 0 },
  { at: Date.UTC(2021, 4, 16, 2), offsetMinutes: 60 },
  { at: Date.UTC(2022, 2, 27, 2), offsetMinutes: 0 },
  { at: Date.UTC(2022, 4, 8, 2), offsetMinutes: 60 },
  { at: Date.UTC(2023, 2, 19, 2), offsetMinutes: 0 },
  { at: Date.UTC(2023, 3, 23, 2), offsetMinutes: 60 },
  { at: Date.UTC(2024, 2, 10, 2), offsetMinutes: 0 },
  { at: Date.UTC(2024, 3, 14, 2), offsetMinutes: 60 },
  { at: Date.UTC(2025, 1, 23, 2), offsetMinutes: 0 },
  { at: Date.UTC(2025, 3, 6, 2), offsetMinutes: 60 },
  { at: Date.UTC(2026, 1, 15, 2), offsetMinutes: 0 },
  { at: Date.UTC(2026, 2, 22, 2), offsetMinutes: 60 },
  { at: Date.UTC(2026, 8, 20, 1), offsetMinutes: 0 },
]

const CASABLANCA_INITIAL_OFFSET_MINUTES = 0

function casablancaOffsetMinutes(atMs: number): number {
  let offset = CASABLANCA_INITIAL_OFFSET_MINUTES
  for (const transition of CASABLANCA_TRANSITIONS) {
    if (atMs < transition.at) break
    offset = transition.offsetMinutes
  }
  return offset
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function isoFromParts(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function parseIsoDate(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error(`Date métier invalide : ${value}`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function dayNumberFromParts(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

function dayNumber(value: string): number {
  const { year, month, day } = parseIsoDate(value)
  return dayNumberFromParts(year, month, day)
}

function partsFromDayNumber(value: number): { year: number; month: number; day: number } {
  const date = new Date(value * 86_400_000)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

function monthStart(year: number, monthIndex: number): string {
  const date = new Date(Date.UTC(year, monthIndex, 1))
  return isoFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
}

export function addBusinessDays(value: string, days: number): string {
  const { year, month, day } = parseIsoDate(value)
  const next = partsFromDayNumber(dayNumberFromParts(year, month, day) + days)
  return isoFromParts(next.year, next.month, next.day)
}

export function businessDateParts(
  at: Date = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
): BusinessDateParts {
  if (timeZone === BUSINESS_TIME_ZONE) {
    const local = new Date(at.getTime() + casablancaOffsetMinutes(at.getTime()) * 60_000)
    return {
      year: local.getUTCFullYear(),
      month: local.getUTCMonth() + 1,
      day: local.getUTCDate(),
      weekday: local.getUTCDay(),
    }
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(at)
  const values = new Map(parts.map((part) => [part.type, part.value]))
  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
    weekday: WEEKDAY_INDEX[values.get('weekday') ?? ''] ?? 0,
  }
}

export function businessTodayIso(
  now: Date = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  const parts = businessDateParts(now, timeZone)
  return isoFromParts(parts.year, parts.month, parts.day)
}

function rangeForPeriod(
  period: DashboardPeriod,
  customStartDate: string | null | undefined,
  customEndDate: string | null | undefined,
  now: Date,
  timeZone: string,
  allDays: number,
  allFrom: 'reader' | 'legacy',
): BusinessRange {
  const todayParts = businessDateParts(now, timeZone)
  const today = isoFromParts(todayParts.year, todayParts.month, todayParts.day)
  const tomorrow = addBusinessDays(today, 1)

  switch (period) {
    case 'today':
      return { from: today, to: tomorrow }
    case 'yesterday':
      return { from: addBusinessDays(today, -1), to: today }
    case 'week': {
      const diff = todayParts.weekday === 0 ? 6 : todayParts.weekday - 1
      return { from: addBusinessDays(today, -diff), to: tomorrow }
    }
    case 'month':
      return { from: monthStart(todayParts.year, todayParts.month - 1), to: tomorrow }
    case 'last_month':
      return {
        from: monthStart(todayParts.year, todayParts.month - 2),
        to: monthStart(todayParts.year, todayParts.month - 1),
      }
    case 'quarter':
      return {
        from: monthStart(todayParts.year, Math.floor((todayParts.month - 1) / 3) * 3),
        to: tomorrow,
      }
    case 'year':
      return { from: isoFromParts(todayParts.year, 1, 1), to: tomorrow }
    case 'last_year':
      return {
        from: isoFromParts(todayParts.year - 1, 1, 1),
        to: isoFromParts(todayParts.year, 1, 1),
      }
    case 'custom': {
      const from = customStartDate ?? today
      const to = customEndDate ? addBusinessDays(customEndDate, 1) : tomorrow
      if (from > to) {
        // Même normalisation que l'existant : inversion des bornes.
        return { from: addBusinessDays(to, -1), to: addBusinessDays(from, 1) }
      }
      return { from, to }
    }
    case 'all':
    default:
      return {
        from: allFrom === 'legacy' ? '2000-01-01' : addBusinessDays(today, -allDays),
        to: tomorrow,
      }
  }
}

/** Nombre de journées métier couvertes par `[from, to[`. */
export function businessDayCount(range: BusinessRange): number {
  return Math.max(1, dayNumber(range.to) - dayNumber(range.from))
}

/**
 * Granularité historique des graphiques du Dashboard (legacy et V5).
 *
 * Règle reprise telle quelle du dashboard d'origine, sans invention :
 * mensuel si la durée dépasse 31 jours, **sauf** pour « Ce mois »,
 * « Aujourd'hui », « Hier » et « Cette semaine » qui restent journaliers.
 */
export function chartGranularity(
  period: DashboardPeriod,
  dayCount: number,
): 'day' | 'month' {
  const monthly =
    period !== 'month' &&
    period !== 'today' &&
    period !== 'yesterday' &&
    period !== 'week' &&
    dayCount > 31
  return monthly ? 'month' : 'day'
}

/**
 * Fenêtre du graphique : les filtres « Aujourd'hui » et « Hier » affichent les
 * sept dernières journées (comportement d'origine), sans changer la période des
 * cartes ni des compteurs.
 */
export function chartBusinessRange(
  period: DashboardPeriod,
  range: BusinessRange,
): BusinessRange {
  return period === 'today' || period === 'yesterday'
    ? { from: addBusinessDays(range.from, -6), to: range.to }
    : range
}

/** Période du lecteur V5 : « toujours » est borné à 365 jours. */
export function businessRange(
  period: DashboardPeriod,
  customStartDate?: string | null,
  customEndDate?: string | null,
  now: Date = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
  allDays: number = READER_ALL_DAYS,
): BusinessRange {
  return rangeForPeriod(period, customStartDate, customEndDate, now, timeZone, allDays, 'reader')
}

/** Période des lecteurs legacy : « toujours » démarre au 01/01/2000. */
export function legacyBusinessRange(
  period: DashboardPeriod,
  customStartDate?: string | null,
  customEndDate?: string | null,
  now: Date = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
): BusinessRange {
  return rangeForPeriod(period, customStartDate, customEndDate, now, timeZone, READER_ALL_DAYS, 'legacy')
}

/** Période précédente complète, de même durée, immédiatement avant. */
export function previousBusinessRange(range: BusinessRange): BusinessRange {
  const days = Math.max(1, dayNumber(range.to) - dayNumber(range.from))
  return { from: addBusinessDays(range.from, -days), to: range.from }
}

/**
 * Période précédente des lecteurs legacy, avec les mêmes règles que l'ancien
 * `getPreviousRange` du Dashboard (mois/trimestre/année précédents complets).
 */
export function previousBusinessPeriodRange(
  period: DashboardPeriod,
  current: BusinessRange,
): BusinessRange {
  const currentFrom = parseIsoDate(current.from)

  switch (period) {
    case 'all':
      return current
    case 'today':
    case 'yesterday':
      return { from: addBusinessDays(current.from, -1), to: current.from }
    case 'week':
      return { from: addBusinessDays(current.from, -7), to: current.from }
    case 'month':
    case 'last_month':
      return {
        from: monthStart(currentFrom.year, currentFrom.month - 2),
        to: current.from,
      }
    case 'quarter':
      return { from: monthStart(currentFrom.year, currentFrom.month - 4), to: current.from }
    case 'year':
    case 'last_year':
      return { from: isoFromParts(currentFrom.year - 1, 1, 1), to: current.from }
    case 'custom':
    default: {
      const days = Math.max(1, dayNumber(current.to) - dayNumber(current.from))
      return { from: addBusinessDays(current.from, -days), to: current.from }
    }
  }
}

export function sameBusinessRange(a: BusinessRange, b: BusinessRange): boolean {
  return a.from === b.from && a.to === b.to
}

function timeZoneOffsetMs(timeZone: string, at: Date): number {
  if (timeZone === BUSINESS_TIME_ZONE) {
    return casablancaOffsetMinutes(at.getTime()) * 60_000
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const values = new Map(parts.map((part) => [part.type, part.value]))
  const hour = Number(values.get('hour')) % 24
  const asUtc = Date.UTC(
    Number(values.get('year')),
    Number(values.get('month')) - 1,
    Number(values.get('day')),
    hour,
    Number(values.get('minute')),
    Number(values.get('second')),
  )
  return asUtc - at.getTime()
}

/**
 * Instant UTC du début d'une journée métier. L'itération gère les changements
 * d'offset ; les transitions à minuit ne sont pas utilisées par Jisra.
 */
export function businessDayStartUtc(
  value: string,
  timeZone: string = BUSINESS_TIME_ZONE,
): Date {
  const { year, month, day } = parseIsoDate(value)
  const target = Date.UTC(year, month - 1, day, 0, 0, 0, 0)
  let timestamp = target - timeZoneOffsetMs(timeZone, new Date(target))
  const adjusted = target - timeZoneOffsetMs(timeZone, new Date(timestamp))
  if (adjusted !== timestamp) timestamp = adjusted
  return new Date(timestamp)
}

export function businessRangeToInstants(
  range: BusinessRange,
  timeZone: string = BUSINESS_TIME_ZONE,
): { start: Date; end: Date } {
  return {
    start: businessDayStartUtc(range.from, timeZone),
    end: businessDayStartUtc(range.to, timeZone),
  }
}

/** Libellé d'une journée métier, sans décalage lié au fuseau du navigateur. */
export function formatBusinessDayLabel(
  value: string,
  granularity: 'day' | 'month' = 'day',
): string {
  const [year, month, day = '1'] = value.split('-')
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  return granularity === 'month'
    ? date.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    : date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
}



