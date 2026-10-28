import type { AssistantIntent, AssistantStructuredResponse } from '@/lib/assistant/types'
import type { AnalyticsMetric, KpiEnvelope } from '@/lib/assistant/analytics-contract'

const DEFAULT_SUGGESTIONS = [
  'Analyse mon business',
  'Montre-moi mes ventes',
  'Quels sont mes meilleurs produits ?',
  'Résume mes dépenses',
  'Analyse mon stock',
]

const BLOCKED_STATES = new Set(['forbidden', 'missing', 'unavailable'])

export function buildGreetingResponse(): AssistantStructuredResponse {
  return {
    message_text: 'Bonjour 👋 Comment puis-je vous aider aujourd’hui ?',
    suggestions: DEFAULT_SUGGESTIONS,
    chart: false,
  }
}

export function buildSmallTalkResponse(): AssistantStructuredResponse {
  return {
    message_text: 'Avec plaisir 🙌 Dites-moi ce que vous voulez analyser sur votre store.',
    suggestions: DEFAULT_SUGGESTIONS,
    chart: false,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function isEnvelope(value: unknown): value is KpiEnvelope {
  const record = asRecord(value)
  return Boolean(record) && record?.kind === 'kpis' && typeof record.metrics === 'object'
}

/**
 * Affichage d'une métrique V2 : aucune valeur si l'état l'interdit, aucun
 * arrondi sur un décimal exact, réserve explicite si `partial`.
 */
export function formatMetricValue(
  metric: AnalyticsMetric | null | undefined,
  currency: string | null = null
): string | null {
  if (!metric || metric.value === null) return null
  if (metric.state === 'missing' || metric.state === 'forbidden' || metric.state === 'unavailable') return null

  const suffix = metric.unit === 'percent' ? ' %' : metric.unit === 'decimal' && currency ? ` ${currency}` : ''
  const reserve = metric.state === 'partial' ? ' (partiel)' : ''
  return `${metric.value}${suffix}${reserve}`
}

const SUMMARY_METRICS: Array<{ alias: string; label: string }> = [
  { alias: 'totalOrders', label: 'Commandes' },
  { alias: 'deliveredOrders', label: 'Commandes livrées' },
  { alias: 'revenue', label: 'CA réalisé' },
  { alias: 'adSpend', label: 'Dépenses publicitaires' },
  { alias: 'contributionMargin', label: 'Marge contributive (hors dépenses)' },
]

function envelopeSummary(envelope: KpiEnvelope): Array<{ label: string; value: string | number }> {
  if (BLOCKED_STATES.has(envelope.state)) return []

  const summary: Array<{ label: string; value: string | number }> = []
  for (const { alias, label } of SUMMARY_METRICS) {
    const formatted = formatMetricValue(envelope.metrics[alias], envelope.currency ?? null)
    if (formatted !== null) summary.push({ label, value: formatted })
  }
  return summary
}

function dailyChart(daily: unknown, currency: string | null) {
  const record = asRecord(daily)
  if (!record) return null
  if (typeof record.state === 'string' && BLOCKED_STATES.has(record.state)) return null

  const source = Array.isArray(record.days) ? record.days : Array.isArray(record.rows) ? record.rows : []
  const points = source
    .map((row) => asRecord(row))
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .filter((row) => typeof row.date === 'string' && typeof row.revenue === 'string')
    .map((row) => ({ date: String(row.date), revenue: String(row.revenue) }))
    .slice(-14)

  if (points.length < 2) return null

  return {
    chart: true,
    chart_type: 'line' as const,
    chart_title: 'Évolution du chiffre d’affaires',
    chart_description: `CA réalisé par journée métier${currency ? ` (${currency})` : ''}.`,
    chart_data: points,
  }
}

function sectionRows(section: unknown): Record<string, unknown>[] {
  const record = asRecord(section)
  if (!record) return []
  const meta = asRecord(record.meta)
  if (meta && typeof meta.state === 'string' && BLOCKED_STATES.has(meta.state)) return []
  return Array.isArray(record.rows)
    ? (record.rows.map((row) => asRecord(row)).filter(Boolean) as Record<string, unknown>[])
    : []
}

function productChart(section: unknown) {
  const points = sectionRows(section)
    .filter((row) => typeof row.revenue === 'string')
    .map((row) => ({ name: String(row.productName ?? 'Produit'), revenu: String(row.revenue) }))
    .slice(0, 10)

  if (points.length === 0) return null

  return {
    chart: true,
    chart_type: 'bar' as const,
    chart_title: 'Produits par chiffre d’affaires',
    chart_description: 'Classement borné : la somme n’est pas le CA total. Aucun profit affiché.',
    chart_data: points,
  }
}

function cityChart(section: unknown) {
  const points = sectionRows(section)
    .filter((row) => typeof row.revenue === 'string')
    .map((row) => ({ name: String(row.city ?? 'Ville non renseignée'), revenu: String(row.revenue) }))
    .slice(0, 10)

  if (points.length === 0) return null

  return {
    chart: true,
    chart_type: 'bar' as const,
    chart_title: 'Chiffre d’affaires par ville',
    chart_description: 'CA des lignes livrées, sans marge ni coût.',
    chart_data: points,
  }
}

export function buildStructuredResponseFromContext(
  intent: AssistantIntent,
  aiText: string,
  context: unknown
): AssistantStructuredResponse {
  const record = asRecord(context) ?? {}
  const envelope = isEnvelope(record.envelope) ? record.envelope : null
  const currency = typeof record.currency === 'string' ? record.currency : envelope?.currency ?? null

  const base: AssistantStructuredResponse = {
    message_text: aiText,
    suggestions: DEFAULT_SUGGESTIONS,
    warnings: envelope ? [...envelope.issues, ...envelope.limits] : [],
    chart: false,
    metrics_summary: envelope ? envelopeSummary(envelope) : [],
  }

  // Aucun graphique sur une donnée absente ou interdite.
  if (envelope && BLOCKED_STATES.has(envelope.state)) return base

  const temporal =
    intent === 'chart_request' || intent === 'dashboard_summary' || intent === 'performance_request'
      ? dailyChart(record.daily, currency)
      : null

  const chart =
    temporal ??
    (intent === 'top_products' ? productChart(record.products) : null) ??
    (intent === 'performance_request' || intent === 'chart_request' ? cityChart(record.cities) : null)

  return chart ? { ...base, ...chart } : base
}
