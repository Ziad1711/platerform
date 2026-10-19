/**
 * Mise en forme du payload `rpc_dashboard_kpi_reader` pour les composants.
 *
 * - une seule boutique : totaux serveur tels quels ;
 * - plusieurs boutiques : agrégation uniquement si **une seule devise** et
 *   **un seul niveau d'accès** ; sinon `mixed = true` et aucun montant n'est
 *   additionné (jamais de somme inter-devises) ;
 * - additions de montants en arithmétique décimale exacte (BigInt), sans float.
 */
import type {
  KpiReaderAccess,
  KpiReaderCoverage,
  KpiReaderPayload,
  KpiReaderPoint,
  KpiReaderStore,
  KpiReaderTotalsCommercial,
  KpiReaderTotalsFull,
} from './kpi-reader'

export type KpiReaderTotals = KpiReaderTotalsFull | KpiReaderTotalsCommercial

export interface KpiReaderScope {
  access: KpiReaderAccess
  currency: string | null
  mixed: boolean
  incomplete: boolean
  coverage: KpiReaderCoverage
  totals: KpiReaderTotals | null
  points: KpiReaderPoint[]
  stores: number
}

/** Somme exacte de chaînes décimales, sans flottant ni BigInt littéral. */
function parseDecimal(value: string): { negative: boolean; digits: string; scale: number } {
  const text = String(value ?? '0').trim()
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text)
  if (!match) return { negative: false, digits: '0', scale: 0 }
  const fraction = match[3] ?? ''
  return { negative: match[1] === '-', digits: `${match[2]}${fraction}`, scale: fraction.length }
}

function compareDigits(a: string, b: string): number {
  const left = a.replace(/^0+(?=\d)/, '')
  const right = b.replace(/^0+(?=\d)/, '')
  if (left.length !== right.length) return left.length > right.length ? 1 : -1
  return left === right ? 0 : left > right ? 1 : -1
}

function addDigits(a: string, b: string): string {
  let result = ''
  let carry = 0
  let i = a.length - 1
  let j = b.length - 1
  while (i >= 0 || j >= 0 || carry > 0) {
    const sum = (i >= 0 ? Number(a[i]) : 0) + (j >= 0 ? Number(b[j]) : 0) + carry
    result = `${sum % 10}${result}`
    carry = sum >= 10 ? 1 : 0
    i -= 1
    j -= 1
  }
  return result
}

function subtractDigits(a: string, b: string): string {
  let result = ''
  let borrow = 0
  let i = a.length - 1
  let j = b.length - 1
  while (i >= 0) {
    const left = Number(a[i]) - borrow
    const right = j >= 0 ? Number(b[j]) : 0
    let diff = left - right
    if (diff < 0) {
      diff += 10
      borrow = 1
    } else {
      borrow = 0
    }
    result = `${diff}${result}`
    i -= 1
    j -= 1
  }
  return result
}

export function sumDecimal(values: string[]): string {
  const parsed = values.map((value) => parseDecimal(value))
  const scale = parsed.reduce((max, item) => Math.max(max, item.scale), 0)

  let negative = false
  let magnitude = '0'

  for (const item of parsed) {
    const padded = item.digits.padEnd(item.digits.length + (scale - item.scale), '0')
    if (magnitude === '0') {
      magnitude = padded
      negative = item.negative
      continue
    }
    if (negative === item.negative) {
      magnitude = addDigits(magnitude, padded)
      continue
    }
    const order = compareDigits(magnitude, padded)
    if (order === 0) {
      magnitude = '0'
      negative = false
    } else if (order > 0) {
      magnitude = subtractDigits(magnitude, padded)
    } else {
      magnitude = subtractDigits(padded, magnitude)
      negative = item.negative
    }
  }

  const normalized = magnitude.replace(/^0+(?=\d)/, '').padStart(scale + 1, '0')
  const integer = normalized.slice(0, normalized.length - scale)
  const fraction = scale > 0 ? `.${normalized.slice(normalized.length - scale)}` : ''
  const zero = /^0+$/.test(normalized)
  return `${negative && !zero ? '-' : ''}${integer}${fraction}`
}


const EMPTY_COVERAGE: KpiReaderCoverage = {
  days_total: 0,
  days_aggregate: 0,
  days_direct: 0,
  days_dirty: 0,
  days_missing: 0,
  days_incompatible: 0,
  days_partial: 0,
}

function addCoverage(a: KpiReaderCoverage, b: KpiReaderCoverage): KpiReaderCoverage {
  return {
    days_total: a.days_total + b.days_total,
    days_aggregate: a.days_aggregate + b.days_aggregate,
    days_direct: a.days_direct + b.days_direct,
    days_dirty: a.days_dirty + b.days_dirty,
    days_missing: a.days_missing + b.days_missing,
    days_incompatible: a.days_incompatible + b.days_incompatible,
    days_partial: a.days_partial + b.days_partial,
  }
}

const COUNT_KEYS = [
  'orders_count',
  'delivered_count',
  'cancelled_count',
  'returned_count',
  'refused_count',
  'pending_count',
  'unclassified_count',
  'ads_daily_days',
] as const

const MONEY_KEYS = [
  'revenue',
  'revenue_estimated',
  'discount_amount',
  'delivery_charge_customer',
  'purchase_cost',
  'delivery_fee_cost',
  'confirmation_cost',
  'ads_tracked',
  'ads_fallback',
  'ad_spend_contract',
  'contribution_margin',
] as const

const QUALITY_COUNT_KEYS = [
  'orders_without_lines',
  'delivered_without_lines',
  'line_vs_total_mismatch',
  'zero_purchase_with_revenue',
  'data_issues_count',
] as const

function sumTotals(stores: KpiReaderStore[], access: KpiReaderAccess): KpiReaderTotals {
  const totals = stores.map((store) => store.totals as unknown as Record<string, unknown>)
  const base: Record<string, unknown> = {}
  for (const key of COUNT_KEYS) {
    base[key] = totals.reduce((acc, item) => acc + Number(item[key] ?? 0), 0)
  }
  for (const key of MONEY_KEYS) {
    base[key] = sumDecimal(totals.map((item) => String(item[key] ?? '0')))
  }
  const quality: Record<string, unknown> = {}
  for (const key of QUALITY_COUNT_KEYS) {
    quality[key] = totals.reduce(
      (acc, item) => acc + Number((item.quality as Record<string, unknown>)?.[key] ?? 0),
      0,
    )
  }
  base.quality = quality
  base.aov = '0'
  base.delivery_rate = '0'
  base.cpl = '0'
  base.cpa = '0'
  base.roas = '0'
  if (access === 'full') base.margin_rate = '0'
  return base as unknown as KpiReaderTotals
}

function mergePoints(stores: KpiReaderStore[]): KpiReaderPoint[] {
  const byDate = new Map<string, KpiReaderPoint>()
  for (const store of stores) {
    for (const point of store.points) {
      const current = byDate.get(point.date)
      if (!current) {
        byDate.set(point.date, { ...point })
        continue
      }
      current.orders_count += point.orders_count
      current.delivered_count += point.delivered_count
      current.cancelled_count += point.cancelled_count
      current.returned_count += point.returned_count
      current.pending_count += point.pending_count
      current.unclassified_count += point.unclassified_count
      current.revenue = sumDecimal([current.revenue, point.revenue])
      current.ads = sumDecimal([current.ads, point.ads])
      current.partial = current.partial || point.partial
      if (point.purchase_cost !== undefined) {
        current.purchase_cost = sumDecimal([current.purchase_cost ?? '0', point.purchase_cost])
      }
      if (point.contribution_margin !== undefined) {
        current.contribution_margin = sumDecimal([
          current.contribution_margin ?? '0',
          point.contribution_margin,
        ])
      }
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
}

export function buildReaderScope(payload: KpiReaderPayload): KpiReaderScope {
  const stores = payload.stores
  if (stores.length === 0) {
    return {
      access: 'commercial',
      currency: null,
      mixed: false,
      incomplete: true,
      coverage: EMPTY_COVERAGE,
      totals: null,
      points: [],
      stores: 0,
    }
  }

  if (stores.length === 1) {
    const store = stores[0]
    return {
      access: store.access,
      currency: store.currency,
      mixed: false,
      incomplete: store.incomplete,
      coverage: store.coverage,
      totals: store.totals,
      points: store.points,
      stores: 1,
    }
  }

  const currencies = new Set(stores.map((store) => store.currency))
  const accesses = new Set(stores.map((store) => store.access))
  const coverage = stores.reduce((acc, store) => addCoverage(acc, store.coverage), EMPTY_COVERAGE)

  if (currencies.size > 1 || accesses.size > 1) {
    // Aucune addition possible : l'UI doit ventiler par devise / niveau d'accès.
    return {
      access: 'commercial',
      currency: null,
      mixed: true,
      incomplete: payload.incomplete,
      coverage,
      totals: null,
      points: [],
      stores: stores.length,
    }
  }

  const access = stores[0].access
  return {
    access,
    currency: stores[0].currency,
    mixed: false,
    incomplete: payload.incomplete,
    coverage,
    totals: sumTotals(stores, access),
    points: mergePoints(stores),
    stores: stores.length,
  }
}
