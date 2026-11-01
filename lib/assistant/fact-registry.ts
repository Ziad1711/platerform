/**
 * Registre des faits vérifiés d'un tour de l'assistant.
 *
 * Un fait porte sa provenance complète : boutique, période, devise, unité et
 * source. Un nombre du texte rédigé par le modèle n'est accepté que si un fait
 * de ce registre le corrobore ET si la phrase ne lui attribue ni une autre
 * devise, ni une autre unité, ni une autre période.
 *
 * Une simple égalité numérique ne suffit donc jamais : le même montant publié
 * pour une autre boutique, une autre devise ou une autre période ne rend pas
 * une phrase vérifiée.
 */
import type { AnalyticsState } from '@/lib/assistant/analytics-contract'

/** États dont la valeur peut être citée (avec réserve pour `partial`). */
const PUBLISHABLE_STATES: ReadonlySet<string> = new Set(['complete', 'empty', 'partial'])

const MAX_FACTS = 400

export type VerifiedFactUnit = 'currency' | 'count' | 'percent'

export interface VerifiedFactRange {
  /** Journée métier incluse, `YYYY-MM-DD`. */
  from: string
  /** Journée métier exclue, `YYYY-MM-DD`. */
  to: string
}

export interface VerifiedFact {
  /** Texte décimal exact tel que publié par l'outil. */
  value: string
  storeId: string
  currency: string | null
  unit: VerifiedFactUnit
  range: VerifiedFactRange
  /** Outil ou section d'origine (traçabilité, jamais affiché). */
  source: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asRange(value: unknown): VerifiedFactRange | null {
  const record = asRecord(value)
  const from = typeof record?.from === 'string' ? record.from : null
  const to = typeof record?.to === 'string' ? record.to : null
  if (!from || !to || from >= to) return null
  return { from, to }
}

function publishable(state: unknown): boolean {
  return typeof state === 'string' && PUBLISHABLE_STATES.has(state)
}

/**
 * Collecte les faits publiables d'un tour, limités au périmètre autorisé.
 *
 * - une enveloppe KPI doit désigner exactement une boutique du périmètre ;
 * - une section doit avoir un accès mono-boutique et une devise unique ;
 * - comparaisons et séries journalières ne sont pas collectées : leurs valeurs
 *   sont multi-périodes ou par jour, et ne peuvent pas être attribuées sans
 *   ambiguïté dans une phrase libre.
 */
export function collectVerifiedFacts(
  toolData: Record<string, unknown>,
  scope: { storeIds: readonly string[]; currency: string; range?: VerifiedFactRange | null },
): VerifiedFact[] {
  const facts: VerifiedFact[] = []
  const allowedStores = new Set(scope.storeIds)

  const push = (
    raw: unknown,
    meta: { storeId: string; currency: string | null; unit: VerifiedFactUnit; range: VerifiedFactRange; source: string },
  ) => {
    if (facts.length >= MAX_FACTS) return
    if (raw === null || raw === undefined) return
    const value = typeof raw === 'number' ? (Number.isFinite(raw) ? String(raw) : null) : typeof raw === 'string' ? raw.trim() : null
    if (!value) return
    facts.push({ value, ...meta })
  }

  for (const [source, payload] of Object.entries(toolData)) {
    const record = asRecord(payload)
    if (!record) continue

    if (record.kind === 'kpis') {
      const range = asRange(record.range)
      const currency = typeof record.currency === 'string' ? record.currency : null
      const access = asRecord(record.access)
      const accessStores = access ? Object.keys(access) : []
      if (!range || accessStores.length !== 1) continue
      const storeId = accessStores[0]
      if (!allowedStores.has(storeId)) continue

      const metrics = asRecord(record.metrics)
      if (!metrics) continue
      for (const [alias, metric] of Object.entries(metrics)) {
        const m = asRecord(metric)
        if (!m || !publishable(m.state)) continue
        if (m.value === null || m.value === undefined || typeof m.value === 'object') continue
        const unit: VerifiedFactUnit = m.unit === 'percent' ? 'percent' : m.unit === 'count' ? 'count' : 'currency'
        if (unit === 'currency' && !currency) continue
        push(m.value, {
          storeId,
          currency: unit === 'currency' ? currency : null,
          unit,
          range,
          source: `${source}:${alias}`,
        })
      }
      continue
    }

    const meta = asRecord(record.meta)
    if (!meta || !publishable(meta.state)) continue
    const range = asRange(meta.range)
    const currencies = Array.isArray(meta.currencies)
      ? meta.currencies.filter((item): item is string => typeof item === 'string')
      : []
    const access = asRecord(meta.access)
    const accessStores = access ? Object.keys(access) : []
    if (!range || currencies.length !== 1 || accessStores.length !== 1) continue
    const storeId = accessStores[0]
    if (!allowedStores.has(storeId)) continue
    if (scope.currency && currencies[0] !== scope.currency) continue

    const rows = Array.isArray(record.rows) ? record.rows : []
    for (const row of rows) {
      const r = asRecord(row)
      if (!r) continue
      push(r.revenue, { storeId, currency: currencies[0], unit: 'currency', range, source: `${source}:revenue` })
      push(r.profit, { storeId, currency: currencies[0], unit: 'currency', range, source: `${source}:profit` })
      push(r.quantity, { storeId, currency: null, unit: 'count', range, source: `${source}:quantity` })
    }
  }

  return facts
}

/** Déduplication des réserves : casse, accents, ponctuation et espaces. */
export function dedupeMessages(messages: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const message of messages) {
    const text = String(message ?? '').trim()
    if (!text) continue

    const key = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u2019']/g, "'")
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()

    if (seen.has(key)) continue
    seen.add(key)
    result.push(text)
  }

  return result
}

/** État global d'une métrique, tolérant aux objets partiels. */
export function metricState(value: unknown): AnalyticsState | null {
  if (!value || typeof value !== 'object') return null
  const state = (value as { state?: unknown }).state
  return typeof state === 'string' ? (state as AnalyticsState) : null
}

/** Nombre de journées métier d'une période `[from, to[`. */
export function factRangeDays(range: VerifiedFactRange): number {
  const from = Date.parse(`${range.from}T00:00:00.000Z`)
  const to = Date.parse(`${range.to}T00:00:00.000Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0
  return Math.round((to - from) / 86_400_000)
}

/** Mois couverts par une période (1-12), pour valider une date citée. */
export function factRangeMonths(range: VerifiedFactRange): Set<number> {
  const months = new Set<number>()
  const cursor = new Date(`${range.from}T00:00:00.000Z`)
  const end = new Date(`${range.to}T00:00:00.000Z`)
  if (!Number.isFinite(cursor.getTime()) || !Number.isFinite(end.getTime())) return months
  while (cursor < end) {
    months.add(cursor.getUTCMonth() + 1)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return months
}

/** Années couvertes par une période, pour valider une année citée. */
export function factRangeYears(range: VerifiedFactRange): Set<number> {
  const years = new Set<number>()
  const from = new Date(`${range.from}T00:00:00.000Z`)
  const to = new Date(`${range.to}T00:00:00.000Z`)
  if (Number.isFinite(from.getTime())) years.add(from.getUTCFullYear())
  if (Number.isFinite(to.getTime())) {
    const last = new Date(to.getTime() - 86_400_000)
    years.add(last.getUTCFullYear())
  }
  return years
}
