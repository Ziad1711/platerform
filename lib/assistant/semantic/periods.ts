/**
 * Périodes analytiques multiples.
 *
 * Le moteur ne réduit plus une demande à « une période + une référence » : il
 * conserve **toutes** les fenêtres citées, leurs correspondances et, lorsque
 * les mois sont contigus, l'agrégat de la période combinée par année.
 *
 * Exemple réel conservé :
 * `septembre + octobre 2026` ↔ `septembre + octobre 2025`
 * → 4 fenêtres mensuelles, 2 correspondances, 2 agrégats combinés.
 *
 * Aucune expression ne dépend d'une question précise : seuls les noms de mois,
 * les années et les clés relatives sont reconnus.
 */
import type { BusinessRange } from '@/lib/dashboard/business-time'

export type PeriodRelation =
  | 'same_month_previous_year'
  | 'same_window_previous_year'
  | 'previous_window'
  | 'previous_period'

export interface MonthRef {
  year: number
  month: number
}

export interface AnalysisPeriod {
  /** Identifiant stable dans le plan (`p0`, `p1`, …). */
  id: string
  /** Mois couverts ; vide pour une fenêtre relative ou personnalisée. */
  months: MonthRef[]
  /** Journées métier `[from, to[`. */
  range: BusinessRange
  granularity: 'day' | 'month' | 'multi-month'
  /** Année de rattachement, `null` quand la fenêtre n'est pas calendaire. */
  year: number | null
  /** Période de regroupement : agrégat de plusieurs fenêtres d'une année. */
  aggregated: boolean
}

export interface PeriodPair {
  currentId: string
  baselineId: string
  relation: PeriodRelation
}

export interface PeriodPlan {
  kind: 'single' | 'comparison' | 'matrix'
  /** Fenêtres élémentaires, dans l'ordre du texte. */
  periods: AnalysisPeriod[]
  /** Agrégats pluri-mois par année (uniquement si les mois sont contigus). */
  groups: AnalysisPeriod[]
  pairs: PeriodPair[]
}

/** Nombre maximal de fenêtres élémentaires (budget du moteur). */
export const MAX_PLAN_PERIODS = 6

/**
 * Normalisation 1:1 pour la reconnaissance des mois et des années.
 *
 * Les variantes de hamza, de ya et de ta marbouta ne changent pas le sens mais
 * cassent une comparaison littérale : `أكتوبر` et `اكتوبر` doivent être
 * reconnus de la même façon. Toutes les substitutions sont de longueur égale,
 * les indices restent donc alignés entre mois et années.
 */
export function foldForMatching(value: string): string {
  return String(value ?? '')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0629/g, '\u0647')
}

const MONTH_ALIASES: ReadonlyArray<{ month: number; pattern: RegExp }> = (() => {
  const table: Array<[number, string[]]> = [
    [1, ['janvier', 'janv', 'january', 'jan', 'يناير']],
    [2, ['février', 'fevrier', 'févr', 'fevr', 'february', 'فبراير']],
    [3, ['mars', 'march', 'مارس']],
    [4, ['avril', 'avr', 'april', 'ابريل']],
    [5, ['mai', 'may', 'ماي', 'مايو']],
    [6, ['juin', 'june', 'يونيو']],
    [7, ['juillet', 'juil', 'july', 'يوليوز', 'يوليو']],
    [8, ['août', 'aout', 'august', 'غشت', 'اغسطس']],
    [9, ['septembre', 'sept', 'september', 'شتنبر', 'سبتمبر']],
    [10, ['octobre', 'oct', 'october', 'اكتوبر']],
    [11, ['novembre', 'nov', 'november', 'نونبر', 'نوفمبر']],
    [12, ['décembre', 'decembre', 'déc', 'december', 'دجنبر', 'ديسمبر']],
  ]
  return table.map(([month, names]) => ({
    month,
    // `و?` accepte la conjonction arabe collée (« وأكتوبر »), très fréquente.
    pattern: new RegExp(`(?<![\\p{L}])و?(?:${names.join('|')})(?![\\p{L}])`, 'giu'),
  }))
})()

const RELATIVE_YEAR_BACK = /(?:l['’]année derni[eè]re|l['’]an dernier|année pr[eé]c[eé]dente|العام لي فات|السنة الماضية|العام الماضي|last year)/
const RELATIVE_YEAR_CURRENT = /(?:cette ann[eé]e|ann[eé]e en cours|هاد العام|هذه السنة|this year)/

function toMonthRange(ref: MonthRef): BusinessRange {
  const start = new Date(Date.UTC(ref.year, ref.month - 1, 1))
  const end = ref.month === 12
    ? new Date(Date.UTC(ref.year + 1, 0, 1))
    : new Date(Date.UTC(ref.year, ref.month, 1))
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  }
}

function isCalendarDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/** Normalise une borne (journée métier ou instant ISO) en journée `YYYY-MM-DD`. */
export function normalizeDay(value: string): string | null {
  if (isCalendarDay(value)) return value
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed).toISOString().slice(0, 10)
}

export function monthMentions(message: string): Array<MonthRef & { index: number }> {
  const text = foldForMatching(message)
  const found: Array<MonthRef & { index: number }> = []
  const seen = new Set<string>()

  for (const { month, pattern } of MONTH_ALIASES) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const key = `${month}@${match.index}`
      if (!seen.has(key)) {
        seen.add(key)
        found.push({ month, year: 0, index: match.index })
      }
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1
    }
  }

  return found.sort((a, b) => a.index - b.index)
}

export function yearMentions(message: string): Array<{ year: number; index: number }> {
  const text = foldForMatching(message)
  const found: Array<{ year: number; index: number }> = []
  const pattern = /(?<!\d)(20\d{2})(?!\d)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    found.push({ year: Number(match[1]), index: match.index })
  }
  return found
}

/**
 * Attribution des années aux mois cités.
 *
 * Le texte est découpé par les années rencontrées : les mois situés avant une
 * année appartiennent à cette année. « septembre et octobre 2026 … septembre et
 * octobre 2025 » donne donc 2026 pour les deux premiers mois et 2025 pour les
 * deux suivants, sans répétition de l'année.
 */
export function assignYears(
  months: Array<MonthRef & { index: number }>,
  years: Array<{ year: number; index: number }>,
  fallbackYear: number,
): MonthRef[] {
  if (months.length === 0) return []
  if (years.length === 0) return months.map((month) => ({ year: fallbackYear, month: month.month }))

  const boundaries = [...years].sort((a, b) => a.index - b.index)
  // La position du premier groupe détermine la convention (« 2026 : sept… »
  // ou « sept… 2026 »). Ne pas attribuer un mois à l'année du groupe suivant.
  const yearFirst = boundaries[0].index < months[0].index
  const assigned = months.map((month) => {
    const boundary = yearFirst
      ? [...boundaries].reverse().find((candidate) => candidate.index < month.index)
      : boundaries.find((candidate) => candidate.index > month.index)
    return { year: boundary?.year ?? boundaries[boundaries.length - 1].year, month: month.month }
  })
  // Une année citée sans répétition des mois référence le groupe de mois.
  // Conservation structurelle, indépendante de la langue et des mots « mêmes mois ».
  const mentionedYears = [...new Set(boundaries.map((entry) => entry.year))]
  const representedYears = new Set(assigned.map((entry) => entry.year))
  const monthNumbers = [...new Set(assigned.map((entry) => entry.month))]
  for (const year of mentionedYears) {
    if (!representedYears.has(year)) {
      assigned.push(...monthNumbers.map((month) => ({ year, month })))
    }
  }
  return assigned.filter((entry, index, all) =>
    all.findIndex((other) => other.year === entry.year && other.month === entry.month) === index)
}

/** Années cibles lorsque seules des clés relatives sont citées. */
export function resolveRelativeYears(message: string, currentYear: number): number[] {
  const text = String(message ?? '')
  if (RELATIVE_YEAR_BACK.test(text) && RELATIVE_YEAR_CURRENT.test(text)) {
    return [currentYear, currentYear - 1]
  }
  if (RELATIVE_YEAR_BACK.test(text)) return [currentYear - 1]
  return []
}

function monthsContiguous(months: MonthRef[]): boolean {
  if (months.length <= 1) return true
  const sorted = [...months].sort((a, b) => a.month - b.month)
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].month - sorted[index - 1].month !== 1) return false
  }
  return true
}

function sameMonthSet(a: MonthRef[], b: MonthRef[]): boolean {
  const key = (months: MonthRef[]) =>
    [...months].map((m) => m.month).sort((x, y) => x - y).join(',')
  return key(a) === key(b)
}

function monthNumber(period: AnalysisPeriod, fallback: number): number {
  return period.months[0]?.month ?? fallback
}

/** Nombre de journées métier d'une fenêtre `[from, to[`. */
export function periodDays(period: AnalysisPeriod): number {
  const from = Date.parse(`${period.range.from}T00:00:00.000Z`)
  const to = Date.parse(`${period.range.to}T00:00:00.000Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0
  return Math.round((to - from) / 86_400_000)
}

/**
 * Plan mono-période : aucune comparaison implicite.
 * La fenêtre est conservée telle qu'elle a été résolue, jamais élargie.
 */
export function singlePeriodPlan(range: BusinessRange): PeriodPlan {
  const period: AnalysisPeriod = {
    id: 'p0',
    months: [],
    range,
    granularity: periodDays({ id: 'p0', months: [], range, granularity: 'day', year: null, aggregated: false }) === 1
      ? 'day'
      : 'month',
    year: null,
    aggregated: false,
  }
  return { kind: 'single', periods: [period], groups: [], pairs: [] }
}

/**
 * Plan comparatif explicite (paires de fenêtres relatives déjà résolues).
 * Utilisé lorsque la demande ne cite pas de mois nommés.
 */
export function comparisonPeriodPlan(
  current: BusinessRange,
  baseline: BusinessRange,
): PeriodPlan {
  const build = (id: string, range: BusinessRange): AnalysisPeriod => ({
    id,
    months: [],
    range,
    granularity: periodDays({ id, months: [], range, granularity: 'day', year: null, aggregated: false }) === 1
      ? 'day'
      : 'month',
    year: null,
    aggregated: false,
  })
  return {
    kind: 'comparison',
    periods: [build('p0', current), build('p1', baseline)],
    groups: [],
    pairs: [{ currentId: 'p0', baselineId: 'p1', relation: 'previous_window' }],
  }
}

/**
 * Plan construit à partir de mois nommés et d'années.
 *
 * - chaque couple (année, mois) devient une fenêtre ;
 * - les mois consécutifs d'une même année forment un agrégat si les deux
 *   années citées portent exactement le même ensemble de mois ;
 * - chaque fenêtre est appariée à la même fenêtre de l'année précédente.
 */
export function buildPeriodPlan(input: {
  months: MonthRef[]
  maxPeriods?: number
  /** Comparaison explicitement demandée : autorise l'appariement intra-année. */
  comparisonIntent?: boolean
}): PeriodPlan {
  const max = Math.max(1, input.maxPeriods ?? MAX_PLAN_PERIODS)
  const months = input.months
  if (months.length > max) throw new Error('PLAN_PERIOD_LIMIT')
  if (months.length === 0) {
    throw new Error('PLAN_NO_PERIOD')
  }

  const periods: AnalysisPeriod[] = months.map((month, index) => ({
    id: `p${index}`,
    months: [month],
    range: toMonthRange(month),
    granularity: 'month',
    year: month.year,
    aggregated: false,
  }))

  // Agrégats par année, uniquement si les mois sont contigus et comparables.
  const byYear = new Map<number, AnalysisPeriod[]>()
  for (const period of periods) {
    if (period.year === null) continue
    const bucket = byYear.get(period.year) ?? []
    bucket.push(period)
    byYear.set(period.year, bucket)
  }

  const groups: AnalysisPeriod[] = []
  const yearKeys = [...byYear.keys()].sort((a, b) => b - a)
  const groupable = yearKeys.length >= 2 && yearKeys.every((year) => {
    const bucket = byYear.get(year) ?? []
    const reference = byYear.get(yearKeys[0]) ?? []
    return bucket.length > 1 && sameMonthSet(bucket.map((p) => p.months[0]), reference.map((p) => p.months[0]))
  })

  if (groupable) {
    yearKeys.forEach((year, index) => {
      const bucket = (byYear.get(year) ?? []).slice().sort(
        (a, b) => monthNumber(a, 0) - monthNumber(b, 0),
      )
      const monthRefs = bucket.map((period) => period.months[0])
      if (!monthsContiguous(monthRefs)) return
      groups.push({
        id: `g${index}`,
        months: monthRefs,
        range: {
          from: bucket[0].range.from,
          to: bucket[bucket.length - 1].range.to,
        },
        granularity: 'multi-month',
        year,
        aggregated: true,
      })
    })
  }
  const usableGroups = groups.length === yearKeys.length ? groups : []

  // Chaque année est comparée à la plus proche antérieure du même mois.
  const pairs: PeriodPair[] = []
  for (const period of periods) {
    const month = period.months[0]?.month
    if (!month || period.year === null) continue
    const candidates = periods.filter(
      (other) => other.id !== period.id && other.months[0]?.month === month &&
        other.year !== null && other.year < period.year!,
    )
    if (candidates.length === 0) continue
    const baseline = candidates.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))[0]
    const alreadyPaired = pairs.some(
      (pair) =>
        (pair.currentId === period.id && pair.baselineId === baseline.id) ||
        (pair.currentId === baseline.id && pair.baselineId === period.id),
    )
    if (!alreadyPaired) {
      pairs.push({
        currentId: (period.year! > baseline.year! ? period : baseline).id,
        baselineId: (period.year! > baseline.year! ? baseline : period).id,
        relation: 'same_month_previous_year',
      })
    }
  }

  // Deux mois distincts de la MÊME année : une comparaison explicite ne doit
  // jamais être réduite à une seule période. L'ordre du texte fait foi : la
  // première période citée est la période courante.
  if (input.comparisonIntent === true) {
    // Une période déjà appariée année-sur-année ne reçoit pas de second rôle :
    // sinon un mois de référence deviendrait la période courante d'une
    // comparaison non demandée.
    const paired = new Set<string>()
    for (const pair of pairs) {
      paired.add(pair.currentId)
      paired.add(pair.baselineId)
    }
    for (let index = 0; index < periods.length; index += 1) {
      const period = periods[index]
      if (period.year === null || period.months.length === 0) continue
      if (paired.has(period.id)) continue
      const next = periods
        .slice(index + 1)
        .find((other) =>
          other.year === period.year &&
          other.months.length > 0 &&
          other.months[0].month !== period.months[0].month &&
          !paired.has(other.id),
        )
      if (!next) continue
      pairs.push({ currentId: period.id, baselineId: next.id, relation: 'previous_period' })
      paired.add(period.id)
      paired.add(next.id)
    }
  }

  for (let index = 0; index < usableGroups.length - 1; index += 1) {
    pairs.push({
      currentId: usableGroups[index].id,
      baselineId: usableGroups[index + 1].id,
      relation: 'same_window_previous_year',
    })
  }

  const kind: PeriodPlan['kind'] = pairs.length === 0
    ? 'single'
    : periods.length > 2 || usableGroups.length > 2
      ? 'matrix'
      : 'comparison'

  return { kind, periods, groups: usableGroups, pairs }
}
