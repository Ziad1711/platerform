/**
 * Contrat commun des sections analytiques détaillées.
 *
 * Une section porte toujours : périmètre autorisé, période métier, devise,
 * source, état explicite et contrôles de cohérence avec le lecteur KPI V5.
 * Aucune valeur manquante n’est convertie en zéro.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BusinessRange } from '@/lib/dashboard/business-time'
import { businessRangeToInstants } from '@/lib/dashboard/business-time'
import type { AnalyticsReaderResult } from '@/lib/assistant/analytics-reader'

export type SectionState = 'complete' | 'empty' | 'partial' | 'missing' | 'forbidden' | 'unavailable'

export interface ConsistencyCheck {
  metric: string
  v5: number | string | null
  section: number | string | null
  match: boolean
}

export interface SectionMeta {
  section: string
  state: SectionState
  source: string
  range: BusinessRange
  timeZone: string
  currencies: string[]
  access: Record<string, 'full' | 'commercial'>
  notices: string[]
  limits: string[]
  consistency: ConsistencyCheck[]
}

export interface SectionResult<Row> {
  meta: SectionMeta
  rows: Row[]
  totals: Record<string, string | number | null>
}

export interface SectionRequest {
  supabase: SupabaseClient
  /** Lecture V5 déjà effectuée pour la même période et le même périmètre. */
  kpis: AnalyticsReaderResult
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Montant `numeric` : texte décimal exact conservé, jamais arrondi ni converti. */
export function toDecimalText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

export function instants(range: BusinessRange): { startUtc: string; endUtc: string } {
  const { start, end } = businessRangeToInstants(range)
  return { startUtc: start.toISOString(), endUtc: end.toISOString() }
}

export function baseMeta(
  section: string,
  source: string,
  kpis: AnalyticsReaderResult,
  state: SectionState,
): SectionMeta {
  const access: Record<string, 'full' | 'commercial'> = {}
  for (const store of kpis.stores) access[store.storeId] = store.access
  return {
    section,
    state,
    source,
    range: kpis.range,
    timeZone: kpis.stores[0]?.timeZone ?? 'Africa/Casablanca',
    currencies: Array.from(new Set(kpis.stores.map((store) => store.currency))),
    access,
    notices: [],
    limits: [],
    consistency: [],
  }
}

export function unavailable<Row>(
  section: string,
  source: string,
  kpis: AnalyticsReaderResult,
  reason: string,
): SectionResult<Row> {
  const meta = baseMeta(section, source, kpis, 'unavailable')
  meta.notices.push(reason)
  return { meta, rows: [], totals: {} }
}

export function forbidden<Row>(section: string, source: string, kpis: AnalyticsReaderResult): SectionResult<Row> {
  const meta = baseMeta(section, source, kpis, 'forbidden')
  meta.notices.push('Accès refusé par le lecteur KPI V5 : aucune donnée détaillée n’est retournée.')
  return { meta, rows: [], totals: {} }
}

export function v5Metric(kpis: AnalyticsReaderResult, name: string): string | number | null {
  const values = kpis.stores.map((store) => store.metrics[name]?.value ?? null)
  if (values.length === 0 || values.some((value) => value === null)) return null
  if (values.every((value) => typeof value === 'number')) {
    return (values as number[]).reduce((sum, value) => sum + value, 0)
  }
  if (values.every((value) => typeof value === 'string')) {
    const total = (values as string[]).reduce((sum, value) => sum + Number(value), 0)
    return Number.isFinite(total) ? String(total) : null
  }
  return null
}

export function check(metric: string, v5: string | number | null, section: string | number | null): ConsistencyCheck {
  if (v5 === null || section === null) return { metric, v5, section, match: false }
  return { metric, v5, section, match: Number(v5) === Number(section) }
}

export function applyConsistency(meta: SectionMeta, checks: ConsistencyCheck[]): void {
  meta.consistency = checks
  const mismatch = checks.filter((item) => !item.match)
  if (mismatch.length > 0) {
    if (meta.state === 'complete') meta.state = 'partial'
    meta.notices.push(
      `Écart avec le lecteur KPI V5 sur : ${mismatch.map((item) => item.metric).join(', ')}. La valeur détaillée n’est pas utilisée comme référence.`,
    )
  }
}

export function authorizedStoreIds(kpis: AnalyticsReaderResult): string[] {
  return kpis.stores.map((store) => store.storeId)
}

export function allStoresFull(kpis: AnalyticsReaderResult): boolean {
  return kpis.stores.length > 0 && kpis.stores.every((store) => store.access === 'full')
}

export function singleCurrency(kpis: AnalyticsReaderResult): string | null {
  const currencies = Array.from(new Set(kpis.stores.map((store) => store.currency)))
  return currencies.length === 1 ? currencies[0] : null
}
