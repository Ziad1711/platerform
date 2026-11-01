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
  /** Dimension optionnelle : évite d'attribuer un classement au total. */
  dimension?: string
  axis?: 'order' | 'delivery' | 'event'
  access?: 'full' | 'commercial'
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
 * - les comparaisons et séries journalières portent leur propre période ;
 *   une valeur interdite ou non comparable n'est jamais enregistrée.
 */
export function collectVerifiedFacts(
  toolData: Record<string, unknown>,
  scope: { storeIds: readonly string[]; currency: string; range?: VerifiedFactRange | null },
): VerifiedFact[] {
  const facts: VerifiedFact[] = []
  const allowedStores = new Set(scope.storeIds)

  const push = (
    raw: unknown,
    meta: { storeId: string; currency: string | null; unit: VerifiedFactUnit; range: VerifiedFactRange; source: string; dimension?: string; axis?: 'order' | 'delivery' | 'event'; access?: 'full' | 'commercial' },
  ) => {
    if (facts.length >= MAX_FACTS) return
    if (raw === null || raw === undefined) return
    const value = typeof raw === 'number' ? (Number.isFinite(raw) ? String(raw) : null) : typeof raw === 'string' ? raw.trim() : null
    if (!value || !/^-?\d+(?:\.\d+)?$/.test(value)) return
    facts.push({ value, ...meta })
  }

  for (const [source, payload] of Object.entries(toolData)) {
    const record = asRecord(payload)
    if (!record) continue

    if (record.kind === 'periods' && publishable(record.state)) {
      const ranges = asRecord(record.ranges)
      const currency = typeof record.currency === 'string' ? record.currency : null
      if (allowedStores.size !== 1 || !currency || (scope.currency && scope.currency !== currency)) continue
      const storeId = Array.from(allowedStores)[0]
      for (const delta of Array.isArray(record.deltas) ? record.deltas : []) {
        const d = asRecord(delta)
        if (!d || d.state !== 'complete' || typeof d.metric !== 'string' ||
          !['orders', 'delivered', 'revenue', 'adSpend', 'contributionMargin'].includes(d.metric)) continue
        const unit: VerifiedFactUnit = ['orders', 'delivered'].includes(d.metric) ? 'count' : 'currency'
        const factCurrency = unit === 'currency' ? currency : null
        for (const [field, period] of [['current', 'current'], ['baseline', 'baseline']] as const) {
          const range = asRange(ranges?.[period])
          if (range) push(d[field], { storeId, currency: factCurrency, unit, range, source: `${source}:${d.metric}:${field}`, axis: 'order' })
        }
        // Un écart porte sur deux périodes : il ne doit être cité qu'avec
        // une référence explicite à la comparaison, pas à une seule période.
        const current = asRange(ranges?.current)
        const baseline = asRange(ranges?.baseline)
        if (current && baseline && typeof d.delta === 'string') {
          push(d.delta, {
            storeId, currency: factCurrency, unit,
            range: { from: current.from < baseline.from ? current.from : baseline.from, to: current.to > baseline.to ? current.to : baseline.to },
            source: `${source}:${d.metric}:delta`, dimension: 'comparison', axis: 'order',
          })
        }
      }

      // Tunnel de confirmation comparé : les deux périodes sont publiées comme
      // faits (compteurs + taux), afin qu'une baisse/hausse de confirmation
      // puisse être citée avec ses deux valeurs sans être retirée.
      const conf = asRecord(record.confirmation)
      if (conf && conf.state === 'complete') {
        const cur = asRecord(conf.current)
        const base = asRecord(conf.baseline)
        if (cur && base) {
          const curRange = asRange(ranges?.current)
          const baseRange = asRange(ranges?.baseline)
          for (const [confRow, range] of [[cur, curRange], [base, baseRange]] as const) {
            if (!range) continue
            push(confRow.totalOrders, { storeId, currency: null, unit: 'count', range, source: `${source}:confirmation:totalOrders`, axis: 'order' })
            push(confRow.confirmedOrders, { storeId, currency: null, unit: 'count', range, source: `${source}:confirmation:confirmedOrders`, axis: 'order' })
            push(confRow.confirmationRate, { storeId, currency: null, unit: 'percent', range, source: `${source}:confirmation:confirmationRate`, axis: 'order' })
          }
        }
      }
      continue
    }

    if (record.kind === 'daily' && publishable(record.state)) {
      for (const day of Array.isArray(record.days) ? record.days : []) {
        const d = asRecord(day)
        if (!d || d.state !== 'complete' || typeof d.date !== 'string' || !allowedStores.has(String(d.storeId))) continue
        const next = new Date(`${d.date}T00:00:00Z`)
        if (!Number.isFinite(next.getTime())) continue
        next.setUTCDate(next.getUTCDate() + 1)
        const range = { from: d.date, to: next.toISOString().slice(0, 10) }
        const storeId = String(d.storeId)
        for (const [field, unit] of [['orders', 'count'], ['delivered', 'count'], ['revenue', 'currency'], ['ads', 'currency']] as const) {
          if (unit === 'currency' && (typeof d.currency !== 'string' || (scope.currency && d.currency !== scope.currency))) continue
          push(d[field], { storeId, currency: unit === 'currency' ? String(d.currency) : null, unit, range, source: `${source}:${field}`, dimension: d.date, axis: 'order' })
        }
      }
      continue
    }

    if (record.kind === 'kpis') {
      const range = asRange(record.range)
      const currency = typeof record.currency === 'string' ? record.currency : null
      const access = asRecord(record.access)
      const accessStores = access ? Object.keys(access) : []
      if (!range || accessStores.length !== 1) continue
      const storeId = accessStores[0]
      if (!allowedStores.has(storeId)) continue
      if (scope.currency && currency !== scope.currency) continue

      const metrics = asRecord(record.metrics)
      if (!metrics) continue
      for (const [alias, metric] of Object.entries(metrics)) {
        const m = asRecord(metric)
        if (!m || !publishable(m.state)) continue
        if (m.value === null || m.value === undefined || typeof m.value === 'object') continue
        const unit: VerifiedFactUnit = m.unit === 'percent' ? 'percent' : m.unit === 'count' ? 'count' : 'currency'
        if (access?.[storeId] !== 'full' && ['purchaseCost', 'deliveryCost', 'confirmationCost', 'contributionMargin'].includes(alias)) continue
        if (unit === 'currency' && !currency) continue
        push(m.value, {
          storeId,
          currency: unit === 'currency' ? currency : null,
          unit,
          range,
          source: `${source}:${alias}`,
          axis: 'order',
          access: access?.[storeId] === 'full' ? 'full' : 'commercial',
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
      const dimension = typeof r.productName === 'string' ? r.productName : typeof r.city === 'string' ? r.city : undefined
      const permission = access?.[storeId] === 'full' ? 'full' : 'commercial'
      push(r.revenue, { storeId, currency: currencies[0], unit: 'currency', range, source: `${source}:revenue`, dimension, axis: 'order', access: permission })
      if (permission === 'full') push(r.profit, { storeId, currency: currencies[0], unit: 'currency', range, source: `${source}:profit`, dimension, axis: 'order', access: permission })
      push(r.quantity, { storeId, currency: null, unit: 'count', range, source: `${source}:quantity`, dimension, axis: 'order', access: permission })
      if (meta.section === 'cities') {
        for (const field of ['totalOrders', 'confirmedOrders', 'deliveredOrders', 'returnedOrders', 'cancelledOrders'] as const) {
          push(r[field], { storeId, currency: null, unit: 'count', range, source: `${source}:${field}`, dimension, axis: 'order', access: permission })
        }
      }
      if (meta.section === 'confirmation') {
        for (const field of ['totalOrders', 'confirmedOrders', 'deliveredOrders', 'returnedOrders', 'cancelledOrders', 'pendingOrders'] as const) {
          push(r[field], { storeId, currency: null, unit: 'count', range, source: `${source}:${field}`, axis: 'order', access: permission })
        }
        push(r.confirmationRate, { storeId, currency: null, unit: 'percent', range, source: `${source}:confirmationRate`, axis: 'order', access: permission })
      }
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
      .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
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
