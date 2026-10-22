/**
 * Fusion des réponses du lecteur KPI V5 lues en plusieurs fenêtres.
 *
 * Le RPC `rpc_dashboard_kpi_reader` refuse une plage supérieure à 400 jours.
 * Une période personnalisée plus longue est donc lue par segments disjoints,
 * puis recomposée ici : composantes additives additionnées, journées
 * concaténées, ratios **recalculés** (jamais moyennés) et compteurs de
 * couverture sommés. Aucune journée n'est dupliquée : les fenêtres sont
 * disjointes par construction.
 */
import type {
  KpiReaderCoverage,
  KpiReaderCurrencyGroup,
  KpiReaderPayload,
  KpiReaderPoint,
  KpiReaderStore,
  KpiReaderTotals,
} from './kpi-reader'
import { divideDecimal, sumDecimal } from './kpi-reader-mappers'

const INTEGER_FIELDS = [
  'orders_count',
  'delivered_count',
  'cancelled_count',
  'returned_count',
  'refused_count',
  'pending_count',
  'unclassified_count',
  'ads_daily_days',
] as const

const DECIMAL_FIELDS = [
  'revenue',
  'revenue_estimated',
  'discount_amount',
  'delivery_charge_customer',
  'ads_tracked',
  'ads_fallback',
  'ad_spend_contract',
  'purchase_cost',
  'delivery_fee_cost',
  'confirmation_cost',
  'contribution_margin',
] as const

function mergeCoverage(a: KpiReaderCoverage, b: KpiReaderCoverage): KpiReaderCoverage {
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

function mergeQuality(
  a: KpiReaderTotals,
  b: KpiReaderTotals,
): KpiReaderTotals['quality'] {
  const left = (a.quality ?? {}) as unknown as Record<string, number | undefined>
  const right = (b.quality ?? {}) as unknown as Record<string, number | undefined>
  const merged: Record<string, number> = {}
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    merged[key] = Number(left[key] ?? 0) + Number(right[key] ?? 0)
  }
  return merged as unknown as KpiReaderTotals['quality']
}

/** Additionne deux totaux de même accès, puis recalcule les ratios. */
export function mergeTotals(a: KpiReaderTotals, b: KpiReaderTotals): KpiReaderTotals {
  const out: Record<string, unknown> = { ...a }

  for (const field of INTEGER_FIELDS) {
    if (a[field] === undefined && b[field] === undefined) continue
    out[field] = Number(a[field] ?? 0) + Number(b[field] ?? 0)
  }
  for (const field of DECIMAL_FIELDS) {
    // Un accès commercial n'expose pas les coûts : l'absence reste une absence.
    if (a[field] === undefined || b[field] === undefined) {
      delete out[field]
      continue
    }
    out[field] = sumDecimal([String(a[field]), String(b[field])])
  }

  out.quality = mergeQuality(a, b)

  const revenue = String(out.revenue ?? '0')
  const delivered = String(out.delivered_count ?? 0)
  const orders = String(out.orders_count ?? 0)
  const adSpend = String(out.ad_spend_contract ?? '0')
  out.aov = divideDecimal(revenue, delivered)
  out.delivery_rate = divideDecimal(delivered, orders, 6, 2)
  out.cpl = divideDecimal(adSpend, orders)
  out.cpa = divideDecimal(adSpend, delivered)
  out.roas = divideDecimal(revenue, adSpend)
  if (out.contribution_margin !== undefined) {
    out.margin_rate = divideDecimal(String(out.contribution_margin), revenue, 6, 2)
  } else {
    delete out.margin_rate
  }

  return out as unknown as KpiReaderTotals
}

function mergePoints(points: KpiReaderPoint[]): KpiReaderPoint[] {
  return [...points].sort((a, b) => a.date.localeCompare(b.date))
}

function mergeStore(a: KpiReaderStore, b: KpiReaderStore): KpiReaderStore {
  return {
    ...a,
    revision: BigInt(a.revision) >= BigInt(b.revision) ? a.revision : b.revision,
    last_rebuild_at:
      a.last_rebuild_at && b.last_rebuild_at
        ? a.last_rebuild_at > b.last_rebuild_at
          ? a.last_rebuild_at
          : b.last_rebuild_at
        : (a.last_rebuild_at ?? b.last_rebuild_at),
    coverage: mergeCoverage(a.coverage, b.coverage),
    incomplete: a.incomplete || b.incomplete,
    totals: mergeTotals(a.totals, b.totals),
    points: mergePoints([...a.points, ...b.points]),
  }
}

function mergeCurrencies(
  groups: KpiReaderCurrencyGroup[],
): KpiReaderCurrencyGroup[] {
  const byCurrency = new Map<string, KpiReaderCurrencyGroup>()
  for (const group of groups) {
    const current = byCurrency.get(group.currency)
    if (!current) {
      byCurrency.set(group.currency, {
        currency: group.currency,
        totals: { ...group.totals },
      })
      continue
    }
    current.totals.orders_count += group.totals.orders_count
    current.totals.delivered_count += group.totals.delivered_count
    current.totals.revenue = sumDecimal([current.totals.revenue, group.totals.revenue])
    current.totals.ads = sumDecimal([current.totals.ads, group.totals.ads])
  }
  return Array.from(byCurrency.values())
}

/** Recompose un payload unique à partir de fenêtres disjointes, dans l'ordre. */
export function mergeReaderPayloads(payloads: KpiReaderPayload[]): KpiReaderPayload {
  if (payloads.length === 1) return payloads[0]

  const first = payloads[0]
  const stores = new Map<string, KpiReaderStore>()
  for (const payload of payloads) {
    for (const store of payload.stores) {
      const current = stores.get(store.store_id)
      stores.set(store.store_id, current ? mergeStore(current, store) : store)
    }
  }

  return {
    definition_version: Math.max(...payloads.map((payload) => payload.definition_version)),
    range: {
      from: payloads.reduce(
        (min, payload) => (payload.range.from < min ? payload.range.from : min),
        first.range.from,
      ),
      to: payloads.reduce(
        (max, payload) => (payload.range.to > max ? payload.range.to : max),
        first.range.to,
      ),
    },
    generated_at: payloads.reduce(
      (latest, payload) => (payload.generated_at > latest ? payload.generated_at : latest),
      first.generated_at,
    ),
    direct_budget: {
      // Budget de secours : 7 journées par appel, pas par fenêtre. Une lecture
      // découpée ne doit pas annoncer un budget élargi.
      limit: Math.max(...payloads.map((payload) => payload.direct_budget.limit)),
      used: payloads.reduce((sum, payload) => sum + payload.direct_budget.used, 0),
    },
    incomplete: payloads.some((payload) => payload.incomplete),
    stores: Array.from(stores.values()),
    currencies: mergeCurrencies(payloads.flatMap((payload) => payload.currencies)),
  }
}
