export type DashboardPeriod =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'month'
  | 'last_month'
  | 'quarter'
  | 'year'
  | 'last_year'
  | 'custom'
  | 'all'

interface PeriodRangeOptions {
  customStartDate?: string | null
  customEndDate?: string | null
}

function startOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function parseLocalDate(date: string): Date {
  return new Date(`${date}T00:00:00`)
}

// Utility function to conditionally join classNames
export function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(' ')
}

export function normalizeMoroccanPhone(value: unknown): string {
  const normalizedNumerals = String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
  const digits = normalizedNumerals.replace(/\D/g, '')

  const internationalMatch = digits.match(/^(?:00212|212)0?([67]\d{8})$/)
  if (internationalMatch) return `0${internationalMatch[1]}`

  if (/^[67]\d{8}$/.test(digits)) return `0${digits}`
  if (/^0[67]\d{8}$/.test(digits)) return digits

  return digits
}

export function getPeriodRange(period: DashboardPeriod, options?: PeriodRangeOptions): { start: Date | null; end: Date | null } {
  const now = new Date()

  switch (period) {
    case 'today': {
      const start = startOfDay(now)
      return { start, end: addDays(start, 1) }
    }
    case 'yesterday': {
      const end = startOfDay(now)
      const start = addDays(end, -1)
      return { start, end }
    }
    case 'week': {
      const start = startOfDay(now)
      const day = start.getDay()
      const diff = day === 0 ? 6 : day - 1
      start.setDate(start.getDate() - diff)
      return { start, end: addDays(startOfDay(now), 1) }
    }
    case 'month':
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: addDays(startOfDay(now), 1) }
    case 'last_month':
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        end: new Date(now.getFullYear(), now.getMonth(), 1),
      }
    case 'quarter': {
      const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3
      return { start: new Date(now.getFullYear(), quarterStartMonth, 1), end: addDays(startOfDay(now), 1) }
    }
    case 'year':
      return { start: new Date(now.getFullYear(), 0, 1), end: addDays(startOfDay(now), 1) }
    case 'last_year':
      return { start: new Date(now.getFullYear() - 1, 0, 1), end: new Date(now.getFullYear(), 0, 1) }
    case 'all':
      // « Toujours » : borne basse volontairement ancienne (aucune donnée antérieure).
      return { start: new Date(2000, 0, 1), end: addDays(startOfDay(now), 1) }
    case 'custom': {
      const start = options?.customStartDate ? parseLocalDate(options.customStartDate) : null
      const end = options?.customEndDate ? addDays(parseLocalDate(options.customEndDate), 1) : null

      if (start && end && start > end) {
        return { start: addDays(end, -1), end: addDays(start, 1) }
      }

      return { start, end }
    }
    default:
      return { start: null, end: null }
  }
}

export function getPreviousPeriodRange(period: DashboardPeriod): { start: Date | null; end: Date | null } {
  const { start, end } = getPeriodRange(period)
  if (!start) return { start: null, end: null }

  const currentEnd = end ?? new Date()
  const durationMs = currentEnd.getTime() - start.getTime()
  const previousEnd = new Date(start)
  const previousStart = new Date(start.getTime() - durationMs)

  return { start: previousStart, end: previousEnd }
}

// Intl « fr-FR » utilise l'espace fine insécable (U+202F) comme séparateur de milliers :
// trop discrète à l'écran, on la remplace par une espace insécable normale bien visible.
function withVisibleGroupSeparator(value: string): string {
  return value.replace(/\u202f/g, '\u00a0')
}

export function formatNumber(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0
  return withVisibleGroupSeparator(new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(safe))
}

export function formatCurrency(amount: number, currency: string = 'MAD'): string {
  return withVisibleGroupSeparator(
    new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount)
  )
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

// Tracé « crisp » : segments droits, seuls les sommets et les creux sont adoucis
// par un petit arc (rayon exprimé dans les unités du viewBox).
// radius = 0 => angles entièrement vifs.
export function buildRoundedPath(points: { x: number; y: number }[], radius: number = 0): string {
  if (points.length === 0) return ''

  const straight = () =>
    points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${round2(point.x)} ${round2(point.y)}`).join(' ')

  if (points.length < 3 || radius <= 0) return straight()

  let path = `M ${round2(points[0].x)} ${round2(points[0].y)}`

  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1]
    const current = points[i]
    const next = points[i + 1]

    const incomingX = current.x - previous.x
    const incomingY = current.y - previous.y
    const outgoingX = next.x - current.x
    const outgoingY = next.y - current.y

    const incomingLength = Math.hypot(incomingX, incomingY) || 1
    const outgoingLength = Math.hypot(outgoingX, outgoingY) || 1

    // Le rayon ne doit jamais dépasser la moitié du plus court segment adjacent.
    const corner = Math.min(radius, incomingLength / 2, outgoingLength / 2)

    const arcStartX = current.x - (incomingX / incomingLength) * corner
    const arcStartY = current.y - (incomingY / incomingLength) * corner
    const arcEndX = current.x + (outgoingX / outgoingLength) * corner
    const arcEndY = current.y + (outgoingY / outgoingLength) * corner

    path += ` L ${round2(arcStartX)} ${round2(arcStartY)} Q ${round2(current.x)} ${round2(current.y)} ${round2(arcEndX)} ${round2(arcEndY)}`
  }

  const last = points[points.length - 1]
  path += ` L ${round2(last.x)} ${round2(last.y)}`

  return path
}