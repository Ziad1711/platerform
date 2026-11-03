/**
 * Mesure opt-in des lectures de la liste « Ventes ».
 *
 * Activée uniquement avec `NEXT_PUBLIC_SALES_PERF=1` (diagnostic local ou
 * aperçu). Aucune donnée métier n'est enregistrée : ni nom, ni téléphone, ni
 * recherche saisie — seulement la durée, les volumes, les filtres actifs et
 * l'issue de la requête. Désactivée par défaut, elle ne change pas le
 * comportement de la page (les annulations et les erreurs restent propagées).
 *
 * Deux relevés strictement indépendants :
 * - `page` : requête de la liste (15 commandes + total exact), mesurée seule ;
 * - `count` : sonde de comptage facultative, exécutée **après** l'affichage et
 *   jamais attendue par le lecteur principal.
 */

export type SalesReadScope = 'single-store' | 'multi-store'

export type SalesReadOutcome = 'ok' | 'aborted' | 'error'

/** Conditions communes aux deux relevés, sans aucune donnée personnelle. */
export interface SalesReadContext {
  scope: SalesReadScope
  page: number
  pageSize: number
  hasSearch: boolean
  statusFilter: string
}

/** Relevé de la requête de liste : durée du chargement des commandes. */
export interface SalesPageSample extends SalesReadContext {
  kind: 'page'
  rows: number
  totalCount: number | null
  durationMs: number
  outcome: SalesReadOutcome
}

/** Relevé de la sonde de comptage, isolé du relevé de page. */
export interface SalesCountSample extends SalesReadContext {
  kind: 'count'
  totalCount: number | null
  /** `null` quand la sonde n'a pas abouti. */
  durationMs: number | null
  outcome: SalesReadOutcome
}

export type SalesReadSample = SalesPageSample | SalesCountSample

export interface SalesReadSummary {
  samples: number
  page: {
    total: number
    ok: number
    errors: number
    aborted: number
    p50Ms: number | null
    p95Ms: number | null
  }
  count: {
    total: number
    ok: number
    errors: number
    aborted: number
    p50Ms: number | null
  }
}

const ENABLED = process.env.NEXT_PUBLIC_SALES_PERF === '1'
const MAX_SAMPLES = 25
const samples: SalesReadSample[] = []

export function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)))
  return Math.round(sorted[index] * 10) / 10
}

export function summarizeSalesReads(): SalesReadSummary {
  const pageSamples = samples.filter((sample): sample is SalesPageSample => sample.kind === 'page')
  const countSamples = samples.filter((sample): sample is SalesCountSample => sample.kind === 'count')
  const pageOk = pageSamples.filter((sample) => sample.outcome === 'ok')
  const countOk = countSamples.filter(
    (sample): sample is SalesCountSample & { durationMs: number } =>
      sample.outcome === 'ok' && typeof sample.durationMs === 'number'
  )

  return {
    samples: samples.length,
    page: {
      total: pageSamples.length,
      ok: pageOk.length,
      errors: pageSamples.filter((sample) => sample.outcome === 'error').length,
      aborted: pageSamples.filter((sample) => sample.outcome === 'aborted').length,
      p50Ms: percentile(pageOk.map((sample) => sample.durationMs), 0.5),
      p95Ms: percentile(pageOk.map((sample) => sample.durationMs), 0.95),
    },
    count: {
      total: countSamples.length,
      ok: countSamples.filter((sample) => sample.outcome === 'ok').length,
      errors: countSamples.filter((sample) => sample.outcome === 'error').length,
      aborted: countSamples.filter((sample) => sample.outcome === 'aborted').length,
      p50Ms: percentile(countOk.map((sample) => sample.durationMs), 0.5),
    },
  }
}

export function recordSalesRead(sample: SalesReadSample): void {
  if (!ENABLED) return

  samples.push(sample)
  if (samples.length > MAX_SAMPLES) samples.shift()

  if (typeof console !== 'undefined') console.info('[sales-read]', sample)

  if (typeof window !== 'undefined') {
    // Relevés lisibles depuis la console du navigateur pendant le diagnostic.
    const diagnostics = window as unknown as {
      __jisraSalesReads?: SalesReadSample[]
      __jisraSalesReadsSummary?: SalesReadSummary
    }
    diagnostics.__jisraSalesReads = [...samples]
    diagnostics.__jisraSalesReadsSummary = summarizeSalesReads()
  }
}

/**
 * Exécute la sonde de comptage **hors du chemin de rendu** : elle est planifiée
 * après la fin de la tâche courante, jamais attendue par le lecteur principal,
 * et toute erreur ou annulation qu'elle produit reste confinée ici. Les relevés
 * de page déjà enregistrés ne dépendent donc jamais d'elle.
 */
export function scheduleSalesCountProbe(run: () => Promise<void>): void {
  if (!ENABLED) return

  const start = () => {
    void run().catch(() => {
      // Une sonde défaillante ne remonte jamais vers la liste.
    })
  }

  if (typeof setTimeout === 'function') {
    setTimeout(start, 0)
  } else {
    start()
  }
}

