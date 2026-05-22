export type DashboardPeriod = 'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'year' | 'custom'

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
    case 'quarter': {
      const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3
      return { start: new Date(now.getFullYear(), quarterStartMonth, 1), end: addDays(startOfDay(now), 1) }
    }
    case 'year':
      return { start: new Date(now.getFullYear(), 0, 1), end: addDays(startOfDay(now), 1) }
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

export function formatCurrency(amount: number, currency: string = 'MAD'): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
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