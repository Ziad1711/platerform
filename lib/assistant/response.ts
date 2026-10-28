import { z } from 'zod'
import type { AssistantIntent, AssistantStructuredResponse } from '@/lib/assistant/types'
import type { AnalyticsMetric, AnalyticsState, KpiEnvelope } from '@/lib/assistant/analytics-contract'

const DEFAULT_SUGGESTIONS = [
  'Analyse mon business',
  'Montre-moi mes ventes',
  'Quels sont mes meilleurs produits ?',
  'Résume mes dépenses',
  'Analyse mon stock',
]

/** États qui interdisent toute valeur chiffrée dans la réponse. */
const BLOCKED_STATES: ReadonlySet<string> = new Set(['forbidden', 'missing', 'unavailable'])

/** États d'un point graphique réellement traçable. */
const PLOTTABLE_STATES: ReadonlySet<string> = new Set(['complete', 'empty'])

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

/* -------------------------------------------------------------------------- */
/* 1. Sortie du fournisseur : validation stricte, aucun crash                  */
/* -------------------------------------------------------------------------- */

const MAX_TEXT = 8_000
const MAX_WARNING = 300

/**
 * Schéma strict de la sortie IA. Un champ mal typé est **supprimé** et signalé,
 * jamais propagé : un `suggestions` chaîne ou un `warnings` d'objets ne doit ni
 * casser le rendu ni être persisté.
 */
export const AssistantLlmOutputSchema = z.object({
  message_text: z.string().max(MAX_TEXT).optional(),
  conversation_title: z.string().max(120).optional(),
  suggestions: z.array(z.string().min(1).max(120)).max(6).optional(),
  warnings: z.array(z.string().min(1).max(MAX_WARNING)).max(6).optional(),
  activity_steps: z
    .array(z.object({ label: z.string().min(1).max(120), detail: z.string().max(200).optional() }))
    .max(12)
    .optional(),
})

export type AssistantLlmOutput = z.infer<typeof AssistantLlmOutputSchema>

export interface ParsedLlmOutput {
  output: AssistantLlmOutput
  /** Champs rejetés ou JSON invalide, à exposer en avertissement. */
  issues: string[]
  /** Texte brut conservé lorsque la sortie n'est pas du JSON exploitable. */
  rawText: string
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  return text.slice(start, end + 1)
}

/**
 * Analyse la sortie du modèle sans jamais lever : JSON invalide, champs hors
 * schéma et types inattendus sont neutralisés et signalés. Un `message_text`
 * textuel valide est conservé même si d'autres champs sont mal typés.
 */
export function parseAssistantLlmOutput(rawText: string): ParsedLlmOutput {
  const text = typeof rawText === 'string' ? rawText : ''
  const trimmed = text.trim()
  if (!trimmed) return { output: {}, issues: ['LLM_EMPTY_OUTPUT'], rawText: '' }

  const candidate = extractJsonObject(trimmed)
  if (!candidate) {
    const issues = trimmed.includes('{') ? ['LLM_OUTPUT_INVALID_JSON'] : ['LLM_OUTPUT_NOT_JSON']
    return { output: { message_text: trimmed }, issues, rawText: trimmed }
  }

  let json: unknown
  try {
    json = JSON.parse(candidate)
  } catch {
    return { output: { message_text: trimmed }, issues: ['LLM_OUTPUT_INVALID_JSON'], rawText: trimmed }
  }

  const parsed = AssistantLlmOutputSchema.safeParse(json)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `LLM_FIELD_INVALID:${issue.path.join('.') || 'output'}`)

    // Récupération champ par champ : un champ invalide ne détruit pas un texte
    // exploitable, et aucun champ invalide n'est propagé.
    const record = asRecord(json) ?? {}
    const salvaged: AssistantLlmOutput = {}

    const message = z.string().min(1).max(MAX_TEXT).safeParse(record.message_text)
    if (message.success) salvaged.message_text = message.data

    const title = z.string().min(1).max(120).safeParse(record.conversation_title)
    if (title.success) salvaged.conversation_title = title.data

    const suggestions = z.array(z.string().min(1).max(120)).max(6).safeParse(record.suggestions)
    if (suggestions.success) salvaged.suggestions = suggestions.data

    const warnings = z.array(z.string().min(1).max(MAX_WARNING)).max(6).safeParse(record.warnings)
    if (warnings.success) salvaged.warnings = warnings.data

    return { output: salvaged, issues, rawText: trimmed }
  }

  return { output: parsed.data, issues: [], rawText: trimmed }
}

/* -------------------------------------------------------------------------- */
/* 2. Traçabilité des chiffres : aucune valeur non vérifiée dans le texte      */
/* -------------------------------------------------------------------------- */

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
  currency: string | null = null,
): string | null {
  if (!metric || metric.value === null) return null
  if (BLOCKED_STATES.has(metric.state)) return null

  const suffix = metric.unit === 'percent' ? ' %' : metric.unit === 'decimal' && currency ? ` ${currency}` : ''
  const reserve = metric.state === 'partial' ? ' (partiel)' : ''
  return `${metric.value}${suffix}${reserve}`
}

/** Montants extraits d'un texte libre : « 24107.00 », « 24 107,5 », « 1 200 MAD ». */
const AMOUNT_PATTERN = /-?\d[\d\s\u00a0\u202f.,]*\d|-?\d/g

function normalizeAmountToken(token: string): string[] {
  const cleaned = token.replace(/[\s\u00a0\u202f]/g, '')
  const variants = new Set<string>()
  variants.add(cleaned)
  variants.add(cleaned.replace(/,/g, '.'))

  // « 1.234,56 » (format français) → 1234.56
  const french = cleaned.replace(/\./g, '').replace(/,/g, '.')
  if (/^-?\d+(\.\d+)?$/.test(french)) variants.add(french)

  // « 24 107 » → 24107
  variants.add(cleaned.replace(/[.,]/g, ''))

  return Array.from(variants).filter((value) => /^-?\d+(\.\d+)?$/.test(value))
}

function canonicalAmount(value: string): string | null {
  const trimmed = value.trim()
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null
  const [sign, digits] = trimmed.startsWith('-')
    ? ['-', trimmed.slice(1)]
    : ['', trimmed]
  const [integerPart, fractionPart = ''] = digits.split('.')
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '')
  const normalizedFraction = fractionPart.replace(/0+$/, '')
  return `${sign}${normalizedInteger}${normalizedFraction ? `.${normalizedFraction}` : ''}`
}

export interface SanitizedExplanation {
  text: string
  rejectedAmounts: string[]
}

/**
 * Une explication LLM ne peut pas servir de source de chiffres. Le moteur
 * conserve uniquement les phrases sans expression numérique, sans symbole de
 * devise et sans nombre écrit en lettres. Les faits chiffrés sont ensuite
 * reconstruits exclusivement depuis les références métriques V2.
 */
const NUMBER_WORDS = /\b(?:zéro|zero|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt|trente|quarante|cinquante|soixante|cent|cents|mille|million|millions|milliard|milliards)\b/iu
const CURRENCY_WORDS = /\b(?:mad|dh|dhs|dirham|dirhams|euro|euros|eur|usd|dollar|dollars)\b/iu

export function sanitizeNarrative(text: string): SanitizedExplanation {
  const source = String(text || '').trim()
  if (!source) return { text: '', rejectedAmounts: [] }

  const rejectedAmounts: string[] = []
  const sentences = source.split(/(?<=[!?;\n])|(?<=\.)(?=\s|$)/u)
  const kept: string[] = []

  for (const sentence of sentences) {
    const tokens = sentence.match(AMOUNT_PATTERN) ?? []
    const hasWords = NUMBER_WORDS.test(sentence)
    const hasCurrency = CURRENCY_WORDS.test(sentence)
    if (tokens.length > 0 || hasWords || hasCurrency) {
      rejectedAmounts.push(...tokens.map((token) => token.trim()))
      if (hasWords || hasCurrency) rejectedAmounts.push('[expression numérique non vérifiable]')
      continue
    }
    kept.push(sentence)
  }

  return { text: kept.join('').trim(), rejectedAmounts }
}

/**
 * Supprime du texte IA tout montant absent des valeurs validées par les outils.
 *
 * Un chiffre non fourni par une source serveur ne peut pas être vérifié : plutôt
 * que de l'afficher, la phrase fautive est retirée et l'anomalie est signalée.
 */
export function sanitizeExplanation(
  text: string,
  allowedValues: ReadonlyArray<string | null | undefined>,
): SanitizedExplanation {
  const source = String(text || '').trim()
  if (!source) return { text: '', rejectedAmounts: [] }

  const allowed = new Set<string>()
  for (const value of allowedValues) {
    if (value === null || value === undefined) continue
    for (const variant of normalizeAmountToken(String(value))) {
      const canonical = canonicalAmount(variant)
      if (canonical !== null) allowed.add(canonical)
      const integer = canonical?.split('.')[0]
      if (integer) allowed.add(integer)
    }
  }

  const rejectedAmounts: string[] = []
  // Découpage par phrase : jamais à l'intérieur d'un décimal (« 100.00 »).
  const sentences = source.split(/(?<=[!?;\n])|(?<=\.)(?=\s|$)/u)
  const kept: string[] = []

  for (const sentence of sentences) {
    const tokens = sentence.match(AMOUNT_PATTERN) ?? []
    let offending = false

    for (const token of tokens) {
      const variants = normalizeAmountToken(token)
      const verified = variants.some((variant) => {
        const canonical = canonicalAmount(variant)
        return canonical !== null && allowed.has(canonical)
      })
      if (!verified) {
        offending = true
        rejectedAmounts.push(token.trim())
      }
    }

    if (!offending) kept.push(sentence)
  }

  return { text: kept.join('').trim(), rejectedAmounts }
}


/* -------------------------------------------------------------------------- */
/* 3. Graphiques : points traçables, devise unique, libellé exact              */
/* -------------------------------------------------------------------------- */

export interface ChartSeriesPoint {
  label: string
  /** Valeur numérique pour l'échelle du graphique (rendu uniquement). */
  value: number
  /** Libellé exact (décimal non arrondi + devise) pour l'infobulle. */
  valueLabel: string
  currency: string
  /** Identité conservée même en mono-boutique ; aucune fusion implicite. */
  storeId: string
}

export interface ChartResult {
  title: string
  description: string
  type: 'line' | 'bar'
  points: ChartSeriesPoint[]
  warnings: string[]
}

function exactLabel(decimal: string, currency: string | null): string {
  return currency ? `${decimal} ${currency}` : decimal
}

function toScaleValue(decimal: string): number | null {
  const parsed = Number(decimal)
  return Number.isFinite(parsed) ? parsed : null
}

function singleCurrencyOf(values: Array<string | null>): string | null {
  const currencies = new Set(values.filter((value): value is string => Boolean(value)))
  return currencies.size === 1 ? Array.from(currencies)[0] : null
}

/**
 * Série journalière : seuls les points `complete` ou `empty` sont tracés.
 * Une devise unique est exigée ; un point sans devise exacte est écarté.
 */
export function buildDailyChart(
  daily: unknown,
  envelopeCurrency: string | null,
  envelopeStoreId: string | null = '__single_scope__',
): ChartResult | null {
  const record = asRecord(daily)
  if (!record) return null
  if (typeof record.state === 'string' && BLOCKED_STATES.has(record.state)) return null

  const source = Array.isArray(record.days) ? record.days : Array.isArray(record.rows) ? record.rows : []
  const warnings: string[] = []
  let dropped = 0

  const candidates = source
    .map((row) => asRecord(row))
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .map((row) => {
      const state = typeof row.state === 'string' ? row.state : 'missing'
      const currency = typeof row.currency === 'string' ? row.currency : null
      const revenue = typeof row.revenue === 'string' ? row.revenue : null
      if (!PLOTTABLE_STATES.has(state) || !currency || !revenue) {
        dropped += 1
        return null
      }
      const storeId = typeof row.storeId === 'string' ? row.storeId : envelopeStoreId
      if (!storeId) {
        dropped += 1
        return null
      }
      return { date: String(row.date ?? ''), revenue, currency, storeId }
    })
    .filter((row): row is { date: string; revenue: string; currency: string; storeId: string } => Boolean(row))
    .filter((row) => row.date !== '')

  if (dropped > 0) warnings.push(`Graphique : ${dropped} point(s) non traçable(s) écarté(s).`)

  const currency = singleCurrencyOf(candidates.map((row) => row.currency))
  if (!currency || (envelopeCurrency && currency !== envelopeCurrency)) {
    if (candidates.length > 0) warnings.push('Graphique non tracé : devises hétérogènes ou incohérentes.')
    return null
  }

  const stores = new Set(candidates.map((row) => row.storeId))
  if (stores.size !== 1) return null

  const points: ChartSeriesPoint[] = candidates.slice(-14).flatMap((row) => {
    const value = toScaleValue(row.revenue)
    if (value === null) return []
    return [{ label: row.date, value, valueLabel: exactLabel(row.revenue, currency), currency, storeId: row.storeId }]
  })

  if (points.length < 2) return null

  return {
    title: 'Évolution du chiffre d’affaires',
    description: `CA réalisé par journée métier (${currency}), points traçables uniquement.`,
    type: 'line',
    points,
    warnings,
  }
}

function sectionRecord(section: unknown): { rows: Record<string, unknown>[]; currency: string | null; state: string; storeId: string | null } | null {
  const record = asRecord(section)
  if (!record) return null
  const meta = asRecord(record.meta)
  const state = typeof meta?.state === 'string' ? meta.state : 'missing'
  const currencies = Array.isArray(meta?.currencies) ? meta.currencies.filter((item): item is string => typeof item === 'string') : []
  const currency = currencies.length === 1 ? currencies[0] : null
  const access = asRecord(meta?.access)
  const storeIds = access ? Object.keys(access) : []
  const storeId = storeIds.length === 1 ? storeIds[0] : storeIds.length === 0 ? '__single_scope__' : null
  const rows = Array.isArray(record.rows)
    ? (record.rows.map((row) => asRecord(row)).filter((row): row is Record<string, unknown> => Boolean(row)))
    : []
  return { rows, currency, state, storeId }
}

function buildSectionChart(
  section: unknown,
  options: { title: string; description: string; labelField: 'productName' | 'city' },
): ChartResult | null {
  const parsed = sectionRecord(section)
  if (!parsed) return null
  if (!PLOTTABLE_STATES.has(parsed.state)) return null
  if (!parsed.currency || !parsed.storeId) return null

  const points: ChartSeriesPoint[] = []
  for (const row of parsed.rows.slice(0, 10)) {
    const revenue = typeof row.revenue === 'string' ? row.revenue : null
    const value = revenue === null ? null : toScaleValue(revenue)
    if (revenue === null || value === null) continue
    const label = options.labelField === 'productName'
      ? String(row.productName ?? 'Produit')
      : String(row.city ?? 'Ville non renseignée')
    points.push({
      label,
      value,
      valueLabel: exactLabel(revenue, parsed.currency),
      currency: parsed.currency,
      storeId: parsed.storeId,
    })
  }

  if (points.length === 0) return null

  return { title: options.title, description: options.description, type: 'bar', points, warnings: [] }
}

function chartToResponse(chart: ChartResult, currency: string | null): AssistantStructuredResponse {
  const xKey = chart.type === 'line' ? 'date' : 'name'
  return {
    message_text: '',
    chart: true,
    chart_type: chart.type,
    chart_title: chart.title,
    chart_description: currency ? `${chart.description} Devise : ${currency}.` : chart.description,
    chart_data: chart.points.map((point) => ({
      [xKey]: point.label,
      value: point.value,
      valueLabel: point.valueLabel,
      currency: point.currency,
      storeId: point.storeId,
    })),
    warnings: chart.warnings,
  }
}


/* -------------------------------------------------------------------------- */
/* 4. Assemblage de la réponse : états, avertissements et graphiques           */
/* -------------------------------------------------------------------------- */

function envelopeSummary(envelope: KpiEnvelope): Array<{ label: string; value: string | number }> {
  if (BLOCKED_STATES.has(envelope.state)) return []

  const summary: Array<{ label: string; value: string | number }> = []
  for (const { alias, label } of SUMMARY_METRICS) {
    const formatted = formatMetricValue(envelope.metrics[alias], envelope.currency ?? null)
    if (formatted !== null) summary.push({ label, value: formatted })
  }
  return summary
}

const SUMMARY_METRICS: Array<{ alias: string; label: string }> = [
  { alias: 'totalOrders', label: 'Commandes' },
  { alias: 'deliveredOrders', label: 'Commandes livrées' },
  { alias: 'revenue', label: 'CA réalisé' },
  { alias: 'adSpend', label: 'Dépenses publicitaires' },
  { alias: 'contributionMargin', label: 'Marge contributive (hors dépenses)' },
]

/** Avertissements portés par une section (`meta`), quel que soit son état. */
export function sectionWarnings(section: unknown): string[] {
  const record = asRecord(section)
  if (!record) return []
  const meta = asRecord(record.meta)
  if (!meta) return []

  const warnings: string[] = []
  for (const key of ['notices', 'issues', 'limits'] as const) {
    const values = Array.isArray(meta[key]) ? meta[key] : []
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) warnings.push(value.trim())
    }
  }
  return warnings
}

/** État d'une section, utilisé pour propager `unavailable`/`forbidden`. */
export function sectionState(section: unknown): AnalyticsState | null {
  const record = asRecord(section)
  const meta = asRecord(record?.meta)
  const state = typeof meta?.state === 'string' ? meta.state : null
  const allowed: AnalyticsState[] = ['complete', 'empty', 'partial', 'missing', 'forbidden', 'unavailable']
  return state && (allowed as string[]).includes(state) ? (state as AnalyticsState) : null
}

export interface StructuredContext {
  envelope?: unknown
  daily?: unknown
  products?: unknown
  cities?: unknown
}

/**
 * Construit la partie structurée de la réponse (graphiques, résumé, alertes).
 * Aucun graphique n'est produit sur une donnée absente, interdite ou multidevise.
 */
export function buildStructuredResponseFromContext(
  intent: AssistantIntent,
  aiText: string,
  context: unknown,
): AssistantStructuredResponse {
  const record = asRecord(context) ?? {}
  const envelope = isEnvelope(record.envelope) ? record.envelope : null
  const currency = typeof record.currency === 'string' ? record.currency : envelope?.currency ?? null

  const warnings = new Set<string>()
  if (envelope) {
    for (const issue of envelope.issues ?? []) warnings.add(issue)
    for (const limit of envelope.limits ?? []) warnings.add(limit)
  }

  const base: AssistantStructuredResponse = {
    message_text: aiText,
    suggestions: DEFAULT_SUGGESTIONS,
    warnings: Array.from(warnings),
    chart: false,
    metrics_summary: envelope ? envelopeSummary(envelope) : [],
  }

  const envelopeStoreIds = envelope ? Object.keys(envelope.access ?? {}) : []
  const envelopeStoreId = envelopeStoreIds.length === 1 ? envelopeStoreIds[0] : null

  // Aucun graphique sur une donnée absente ou interdite.
  if (envelope && BLOCKED_STATES.has(envelope.state)) return base

  const daily =
    intent === 'chart_request' || intent === 'dashboard_summary' || intent === 'performance_request'
      ? buildDailyChart(record.daily, envelope?.currency ?? null, envelopeStoreId)
      : null

  const products = intent === 'top_products' ? buildSectionChart(record.products, {
    title: 'Produits par chiffre d’affaires',
    description: 'Classement borné : la somme n’est pas le CA total. Aucun profit affiché.',
    labelField: 'productName',
  }) : null

  const cities =
    intent === 'performance_request' || intent === 'chart_request'
      ? buildSectionChart(record.cities, {
        title: 'Chiffre d’affaires par ville',
        description: 'CA des lignes livrées, sans marge ni coût.',
        labelField: 'city',
      })
      : null

  const chart = daily ?? products ?? cities
  if (!chart) return base

  for (const warning of chart.warnings) warnings.add(warning)

  return {
    ...base,
    warnings: Array.from(warnings),
    ...chartToResponse(chart, currency),
    message_text: aiText,
    suggestions: DEFAULT_SUGGESTIONS,
    metrics_summary: base.metrics_summary,
  }
}
