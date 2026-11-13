/** Contrat de période du dashboard admin, identique à l'API et à la RPC. */
export type PeriodPreset = '7' | '30' | '90' | '365' | 'custom'
export type PeriodRange = { from: string; until: string }

export const PERIOD_PRESETS: { value: Exclude<PeriodPreset, 'custom'>; label: string; days: number }[] = [
  { value: '7', label: '7 jours', days: 7 },
  { value: '30', label: '30 jours', days: 30 },
  { value: '90', label: '90 jours', days: 90 },
  { value: '365', label: '12 mois', days: 365 },
]

export function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

/** Intervalle [from, until) en dates UTC, fin exclue. */
export function presetRange(days: number, now: Date = new Date()): PeriodRange {
  const until = new Date(now)
  until.setUTCHours(0, 0, 0, 0)
  until.setUTCDate(until.getUTCDate() + 1)
  const from = new Date(until)
  from.setUTCDate(from.getUTCDate() - days)
  return { from: isoDate(from), until: isoDate(until) }
}

/** Validation locale alignée sur le serveur : format, ordre, 366 jours maximum. */
export function validateRange(from: string, until: string): string | null {
  const pattern = /^\d{4}-\d{2}-\d{2}$/
  if (!pattern.test(from) || !pattern.test(until)) return 'Dates attendues au format AAAA-MM-JJ.'
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${until}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Dates invalides.'
  if (end <= start) return 'La date de fin (exclue) doit suivre la date de début.'
  if (end - start > 366 * 86_400_000) return 'La période ne peut pas dépasser 366 jours.'
  return null
}

export function shortDate(value: string) {
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year?.slice(2) ?? ''}`
}

export function periodLabel(preset: PeriodPreset, range: PeriodRange) {
  const match = PERIOD_PRESETS.find((item) => item.value === preset)
  return match ? match.label : `${shortDate(range.from)} → ${shortDate(range.until)}`
}
