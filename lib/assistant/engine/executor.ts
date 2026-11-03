/**
 * Exécuteur contrôlé des lectures analytiques.
 *
 * Le moteur n'exécute jamais de SQL libre : il appelle **uniquement** les
 * lecteurs validés du produit (`readAssistantKpis`, sections RPC existantes),
 * avec un plafond de fenêtres, une concurrence bornée et une classification
 * normalisée des échecs.
 *
 * Toute erreur technique devient un code interne d'exécution ; la couche de
 * restitution décide seule de ce qui est montré à l'utilisateur.
 *
 * Le périmètre de boutiques est toujours un paramètre explicite : aucun état
 * global, donc aucune fuite possible entre deux requêtes simultanées.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { readAssistantKpis } from '@/lib/assistant/analytics-reader'
import type { AnalyticsReaderResult, SectionResult } from '@/lib/assistant/analytics-contract'
import type { BusinessRange } from '@/lib/dashboard/business-time'
import type { AnalysisDimension } from '@/lib/assistant/semantic/request'
import {
  readAgentSection,
  readCitySection,
  readConfirmationSection,
} from '@/lib/assistant/analytics-sections'
import { readProductSection, readRecentOrdersSection } from '@/lib/assistant/analytics-products'
import { EngineBudgetError, type BudgetTracker } from '@/lib/assistant/engine/policy'

/** Codes d'échec d'exécution : jamais exposés tels quels dans une réponse. */
export type ReadingFailureCode =
  | 'gateway_unavailable'
  | 'isolation_failure'
  | 'range_rejected'
  | 'unknown'

export interface WindowReading {
  windowId: string
  range: BusinessRange
  kpis: AnalyticsReaderResult | null
  failure: ReadingFailureCode | null
  durationMs: number
}

export interface ExecuteWindowsInput {
  supabase: SupabaseClient
  /** Périmètre validé par l'appelant (jamais relu ici). */
  storeIds: readonly string[]
  windows: ReadonlyArray<{ id: string; range: BusinessRange }>
  tracker: BudgetTracker
  signal?: AbortSignal
}

/** Traduit une erreur de lecteur en code d'exécution stable. */
export function classifyReadingError(error: unknown): ReadingFailureCode {
  const code = error instanceof Error ? error.message : String(error ?? '')
  if (code.includes('KPI_NO_ACCESS') || code.includes('forbidden')) return 'isolation_failure'
  if (
    code.includes('KPI_BAD_RANGE') ||
    code.includes('KPI_RANGE_TOO_LARGE') ||
    code.includes('ANALYTICS_BAD_RANGE') ||
    code.includes('ANALYTICS_RANGE_TOO_LARGE')
  ) {
    return 'range_rejected'
  }
  if (
    code.includes('KPI_READER_TIMEOUT') ||
    code.includes('KPI_READER_FAILED') ||
    code.includes('KPI_UNAUTHENTICATED')
  ) {
    return 'gateway_unavailable'
  }
  return 'unknown'
}

async function readWindowOnce(
  supabase: SupabaseClient,
  storeIds: readonly string[],
  window: { id: string; range: BusinessRange },
  signal?: AbortSignal,
): Promise<WindowReading> {
  const startedAt = Date.now()
  if (signal?.aborted) {
    return {
      windowId: window.id,
      range: window.range,
      kpis: null,
      failure: 'gateway_unavailable',
      durationMs: 0,
    }
  }

  try {
    // `readAssistantKpis` valide le payload (zod) et conserve les états.
    // Aucun repli direct implicite : la stratégie est décidée en amont.
    const kpis = await readAssistantKpis(supabase, [...storeIds], window.range, { signal })
    return {
      windowId: window.id,
      range: window.range,
      kpis,
      failure: null,
      durationMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      windowId: window.id,
      range: window.range,
      kpis: null,
      failure: classifyReadingError(error),
      durationMs: Date.now() - startedAt,
    }
  }
}

/** Exécute les lectures avec une concurrence strictement bornée. */
export async function readWindows(input: ExecuteWindowsInput): Promise<Map<string, WindowReading>> {
  const { tracker } = input
  const results = new Map<string, WindowReading>()
  const queue = [...input.windows]
  const limit = Math.max(1, tracker.budgets.maxConcurrentReads)

  const worker = async () => {
    for (;;) {
      const window = queue.shift()
      if (!window) return
      tracker.assertTime()
      tracker.consumeRead()
      tracker.consumeOperation()
      const reading = await readWindowOnce(input.supabase, input.storeIds, window, input.signal)
      results.set(window.id, reading)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, input.windows.length) }, worker))
  return results
}

export interface DimensionReading {
  dimension: AnalysisDimension
  windowId: string
  data: SectionResult<Record<string, unknown>> | null
  failure: ReadingFailureCode | null
}

/** Dimensions réellement adossées à une source autorisée. */
export const SUPPORTED_DIMENSIONS: readonly AnalysisDimension[] = [
  'city',
  'product',
  'confirmation',
  'agent',
  'status',
]

export function isDimensionSupported(dimension: AnalysisDimension): boolean {
  return SUPPORTED_DIMENSIONS.includes(dimension)
}

/**
 * Lit une dimension sur la fenêtre principale uniquement : une ventilation
 * détaillée sur six fenêtres coûterait plus que la question ne le justifie.
 */
export async function readDimension(input: {
  supabase: SupabaseClient
  dimension: AnalysisDimension
  reading: WindowReading
  tracker: BudgetTracker
  limit?: number
  signal?: AbortSignal
}): Promise<DimensionReading> {
  const { dimension, reading, tracker } = input
  const base: DimensionReading = {
    dimension,
    windowId: reading.windowId,
    data: null,
    failure: null,
  }

  if (input.signal?.aborted) return { ...base, failure: 'gateway_unavailable' }
  if (!reading.kpis || reading.failure) {
    return { ...base, failure: reading.failure ?? 'unknown' }
  }
  if (!isDimensionSupported(dimension)) return base

  tracker.consumeDimension()
  tracker.consumeOperation()

  const request = { supabase: input.supabase, kpis: reading.kpis, signal: input.signal }
  const limit = Math.max(1, Math.min(input.limit ?? 10, tracker.budgets.maxRowsPerDimension))

  try {
    switch (dimension) {
      case 'city':
        return { ...base, data: sectionAsRecord(await readCitySection(request)) }
      case 'product':
        return { ...base, data: sectionAsRecord(await readProductSection(request, limit)) }
      case 'confirmation':
        return { ...base, data: sectionAsRecord(await readConfirmationSection(request)) }
      case 'agent':
        return { ...base, data: sectionAsRecord(await readAgentSection(request)) }
      case 'status':
        return { ...base, data: sectionAsRecord(await readRecentOrdersSection(request, Math.min(limit, 8))) }
      default:
        return base
    }
  } catch (error) {
    return { ...base, failure: classifyReadingError(error) }
  }
}

/** Les sections sont typées par leur `meta.section` ; le consommateur lit `rows`. */
function sectionAsRecord(section: SectionResult<unknown>): SectionResult<Record<string, unknown>> {
  return section as SectionResult<Record<string, unknown>>
}

/** Un budget dépassé est une limite d'exécution, jamais une absence de donnée. */
export function isBudgetError(error: unknown): error is EngineBudgetError {
  return error instanceof EngineBudgetError
}
