import { z } from 'zod'
import {
  factRangeDays,
  factRangeMonths,
  factRangeYears,
  type VerifiedFact,
} from '@/lib/assistant/fact-registry'
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

const ARABIC_SUGGESTIONS = [
  'حلل الأداء ديالي',
  'وريني المبيعات',
  'شنو أحسن المنتجات',
]

export function buildGreetingResponse(language: 'fr' | 'ar' = 'fr'): AssistantStructuredResponse {
  return language === 'ar'
    ? {
        message_text: 'السلام 👋 كيفاش نقدر نعاونك اليوم؟',
        suggestions: ARABIC_SUGGESTIONS,
        chart: false,
      }
    : {
        message_text: 'Bonjour 👋 Comment puis-je vous aider aujourd’hui ?',
        suggestions: DEFAULT_SUGGESTIONS,
        chart: false,
      }
}

export function buildSmallTalkResponse(language: 'fr' | 'ar' = 'fr'): AssistantStructuredResponse {
  return language === 'ar'
    ? {
        message_text: 'بكل سرور 🙌 قول ليا شنو بغيتي نحلل فالمتجر ديالك.',
        suggestions: ARABIC_SUGGESTIONS,
        chart: false,
      }
    : {
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
/** Devises reconnues dans une phrase, normalisées vers leur code. */
const CURRENCY_ALIASES: Record<string, string> = {
  mad: 'MAD', dh: 'MAD', dhs: 'MAD', dirham: 'MAD', dirhams: 'MAD',
  eur: 'EUR', euro: 'EUR', euros: 'EUR',
  usd: 'USD', dollar: 'USD', dollars: 'USD',
}

const MONTH_ALIASES: Record<string, number> = {
  janvier: 1, janv: 1, fevrier: 2, fev: 2, mars: 3, avril: 4, avr: 4, mai: 5,
  juin: 6, juillet: 7, juil: 7, aout: 8, septembre: 9, sept: 9, octobre: 10, oct: 10,
  novembre: 11, nov: 11, decembre: 12, dec: 12,
}

/** Périodes relatives : la longueur de la période citée doit correspondre. */
const RELATIVE_PERIODS: Array<{ pattern: RegExp; days?: number; maxDays?: number }> = [
  { pattern: /\bhier\b/, days: 1 },
  { pattern: /aujourd[\u2019']?hui/i, days: 1 },
  { pattern: /(?:البارح|أمس|امس)/, days: 1 },
  { pattern: /اليوم/, days: 1 },
  { pattern: /\b7 derniers jours\b/, days: 7 },
  { pattern: /\b30 derniers jours\b/, days: 30 },
  { pattern: /cette semaine|semaine en cours|semaine derni[eè]re|semaine pass[eé]e/, maxDays: 7 },
  { pattern: /ce mois|mois en cours|mois dernier|mois pr[eé]c[eé]dent/, maxDays: 31 },
]

function normalizeWords(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function sentenceCurrency(sentence: string): string | null {
  const matches = normalizeWords(sentence).match(/\b(mad|dhs?|dirhams?|euros?|eur|usd|dollars?)\b/g) ?? []
  for (const token of matches) {
    const code = CURRENCY_ALIASES[token]
    if (code) return code
  }
  return null
}

function sentenceMonths(sentence: string): Set<number> {
  const months = new Set<number>()
  const normalized = normalizeWords(sentence)
  for (const [name, month] of Object.entries(MONTH_ALIASES)) {
    if (new RegExp(`\\b${name}\\b`).test(normalized)) months.add(month)
  }
  return months
}

function isYearToken(token: string): boolean {
  return /^(?:19|20|21)\d{2}$/.test(token)
}

/**
 * Supprime du texte IA tout nombre non corroboré par un fait vérifié du
 * périmètre courant.
 *
 * Un fait porte boutique, période, devise et unité : une phrase qui attribue au
 * nombre une autre devise, un autre mois, une autre année ou une autre durée
 * relative est retirée, même si la valeur numérique existe ailleurs.
 */
export function sanitizeExplanation(
  text: string,
  facts: ReadonlyArray<VerifiedFact>,
): SanitizedExplanation {
  const source = String(text || '').trim()
  if (!source) return { text: '', rejectedAmounts: [] }

  const indexed = new Map<string, VerifiedFact[]>()
  for (const fact of facts) {
    for (const variant of normalizeAmountToken(String(fact.value))) {
      const canonical = canonicalAmount(variant)
      if (canonical === null) continue
      const bucket = indexed.get(canonical)
      if (bucket) bucket.push(fact)
      else indexed.set(canonical, [fact])
    }
  }

  const rejectedAmounts: string[] = []
  const sentences = source.split(/(?<=[!?;\n])|(?<=\.)(?=\s|$)/u)
  const kept: string[] = []

  for (const sentence of sentences) {
    const tokens = sentence.match(AMOUNT_PATTERN) ?? []
    if (tokens.length === 0) {
      kept.push(sentence)
      continue
    }

    const currency = sentenceCurrency(sentence)
    const months = sentenceMonths(sentence)
    const years = new Set<number>()
    for (const token of tokens) {
      if (isYearToken(token.trim())) years.add(Number(token.trim()))
    }
    const relative = RELATIVE_PERIODS.find((entry) => entry.pattern.test(sentence)) ?? null

    const compatible = (fact: VerifiedFact, token: string): boolean => {
      // Une phrase peut contenir à la fois un montant et un taux : l'unité
      // se détermine au voisinage du nombre, jamais au niveau de la phrase.
      const tokenAt = sentence.indexOf(token)
      const afterToken = tokenAt < 0 ? '' : sentence.slice(tokenAt + token.length).trimStart()
      const tokenPercent = afterToken.startsWith('%')
      if (tokenPercent) {
        if (fact.unit !== 'percent') return false
      } else if (fact.unit === 'percent') return false
      if (currency && fact.unit === 'currency' && fact.currency?.toUpperCase() !== currency) return false

      if (months.size > 0) {
        const covered = factRangeMonths(fact.range)
        if (!Array.from(months).some((month) => covered.has(month))) return false
      }
      if (years.size > 0) {
        const covered = factRangeYears(fact.range)
        // Les deux années comparées sont vérifiées séparément ci-dessous :
        // une valeur d'une période n'a pas à couvrir les deux années.
        if (!Array.from(years).some((year) => covered.has(year))) return false
      }
      if (relative) {
        const days = factRangeDays(fact.range)
        if (relative.days !== undefined && days !== relative.days) return false
        if (relative.maxDays !== undefined && days > relative.maxDays) return false
      }
      return true
    }

    let offending = false
    for (const token of tokens) {
      const trimmed = token.trim()

      if (isYearToken(trimmed)) {
        // Une année n'est jamais « vérifiée par sa valeur » : elle doit être
        // couverte par la période d'au moins un fait du tour.
        const covered = facts.some((fact) => factRangeYears(fact.range).has(Number(trimmed)))
        if (!covered) {
          offending = true
          rejectedAmounts.push(trimmed)
        }
        continue
      }

      const candidates = normalizeAmountToken(trimmed)
        .map((variant) => canonicalAmount(variant))
        .filter((value): value is string => value !== null)
        .flatMap((value) => indexed.get(value) ?? [])

      if (!candidates.some((fact) => compatible(fact, trimmed))) {
        offending = true
        rejectedAmounts.push(trimmed)
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
  /**
   * Valeur numérique pour l'échelle (rendu uniquement). `null` = journée sans
   * donnée publiée : la courbe doit être interrompue, jamais comblée par zéro.
   */
  value: number | null
  /** Libellé exact (décimal + devise) pour l'infobulle ; `null` si absent. */
  valueLabel: string | null
  currency: string
  /** Identité conservée même en mono-boutique ; aucune fusion implicite. */
  storeId: string
  /** `true` = journée du périmètre sans valeur publiable. */
  missing?: boolean
}

export interface ChartResult {
  title: string
  description: string
  type: 'line' | 'bar'
  /** Unité affichée sur l'axe : jamais une valeur recalculée. */
  unit: 'currency' | 'count' | 'percent'
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
/** Points maximum affichés sur une courbe : au-delà, la période est signalée. */
const MAX_LINE_POINTS = 31

/** Liste des journées métier `[from, to[`, sans dépendre du fuseau local. */
function businessDayList(range: { from: string; to: string }): string[] {
  const days: string[] = []
  const start = Date.parse(`${range.from}T00:00:00.000Z`)
  const end = Date.parse(`${range.to}T00:00:00.000Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return days
  for (let cursor = start; cursor < end; cursor += 86_400_000) {
    days.push(new Date(cursor).toISOString().slice(0, 10))
  }
  return days
}

export function buildDailyChart(
  daily: unknown,
  envelopeCurrency: string | null,
  envelopeStoreId: string | null = '__single_scope__',
  rangeLabel?: string | null,
): ChartResult | null {
  const record = asRecord(daily)
  if (!record) return null
  if (typeof record.state === 'string' && BLOCKED_STATES.has(record.state)) return null

  const source = Array.isArray(record.days) ? record.days : Array.isArray(record.rows) ? record.rows : []
  const warnings: string[] = []
  let dropped = 0
  let duplicated = false

  const published = new Map<string, { revenue: string; currency: string; storeId: string }>()
  for (const raw of source) {
    const row = asRecord(raw)
    if (!row) {
      dropped += 1
      continue
    }
    const state = typeof row.state === 'string' ? row.state : 'missing'
    const currency = typeof row.currency === 'string' ? row.currency : null
    const revenue = typeof row.revenue === 'string' ? row.revenue : null
    const date = typeof row.date === 'string' ? row.date : ''
    const storeId = typeof row.storeId === 'string' ? row.storeId : envelopeStoreId
    if (!PLOTTABLE_STATES.has(state) || !currency || !revenue || !date || !storeId) {
      dropped += 1
      continue
    }
    if (published.has(date)) {
      duplicated = true
      continue
    }
    published.set(date, { revenue, currency, storeId })
  }

  // Deux boutiques sur la même date ne peuvent pas former une seule série.
  if (duplicated) return null

  const currency = singleCurrencyOf(Array.from(published.values()).map((row) => row.currency))
  if (!currency || (envelopeCurrency && currency !== envelopeCurrency)) {
    if (published.size > 0) warnings.push('Graphique non tracé : devises hétérogènes ou incohérentes.')
    return null
  }

  const stores = new Set(Array.from(published.values()).map((row) => row.storeId))
  if (stores.size > 1) return null
  const storeId = Array.from(stores)[0] ?? envelopeStoreId
  if (!storeId) return null

  const declaredRange = asRecord(record.range)
  const from = typeof declaredRange?.from === 'string' ? declaredRange.from : null
  const to = typeof declaredRange?.to === 'string' ? declaredRange.to : null
  const labels = from && to ? businessDayList({ from, to }) : Array.from(published.keys()).sort()
  if (labels.length === 0) return null

  const shown = labels.slice(-MAX_LINE_POINTS)
  if (labels.length > shown.length) {
    warnings.push(`Graphique limité aux ${MAX_LINE_POINTS} derniers jours de la période.`)
  }

  let gaps = 0
  const points: ChartSeriesPoint[] = shown.map((label) => {
    const hit = published.get(label)
    if (!hit) {
      gaps += 1
      return { label, value: null, valueLabel: null, currency, storeId, missing: true }
    }
    const value = toScaleValue(hit.revenue)
    if (value === null) {
      gaps += 1
      return { label, value: null, valueLabel: null, currency, storeId, missing: true }
    }
    return { label, value, valueLabel: exactLabel(hit.revenue, currency), currency, storeId }
  })

  if (dropped > 0) warnings.push(`Graphique : ${dropped} point(s) non publiable(s) écarté(s).`)
  if (gaps > 0) {
    warnings.push(`${gaps} journée(s) sans donnée publiée : la courbe est interrompue, aucun zéro n’est supposé.`)
  }

  // Au moins deux valeurs réellement publiées : une série de trous n'est pas un résultat.
  if (points.filter((point) => point.value !== null).length < 2) return null

  const period = rangeLabel ? ` — ${rangeLabel}` : ''
  return {
    title: 'Évolution du chiffre d’affaires',
    description: `CA réalisé par journée métier en ${currency}${period}. Les journées sans donnée interrompent la courbe.`,
    type: 'line',
    unit: 'currency',
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

  return { title: options.title, description: options.description, type: 'bar', unit: 'currency', points, warnings: [] }
}

/** Métriques comparables affichables en barres, par ordre de pertinence. */
const COMPARISON_METRICS: Array<{ key: string; label: string; unit: 'currency' | 'count' }> = [
  { key: 'revenue', label: 'Chiffre d’affaires', unit: 'currency' },
  { key: 'orders', label: 'Commandes', unit: 'count' },
  { key: 'delivered', label: 'Commandes livrées', unit: 'count' },
  { key: 'adSpend', label: 'Dépenses publicitaires', unit: 'currency' },
]

/**
 * Barres comparatives pour deux périodes réelles (`kind: 'periods'`).
 * Une seule métrique vérifiée est retenue ; aucune valeur n'est inventée ni
 * interpolée, et une métrique incomplète est ignorée.
 */
export function buildComparisonChart(
  comparison: unknown,
  labels: { current?: string; baseline?: string } | null,
  envelopeCurrency: string | null,
): ChartResult | null {
  const record = asRecord(comparison)
  if (!record || record.kind !== 'periods') return null
  if (typeof record.state === 'string' && BLOCKED_STATES.has(record.state)) return null

  const deltas = Array.isArray(record.deltas)
    ? record.deltas.map((delta) => asRecord(delta)).filter((delta): delta is Record<string, unknown> => Boolean(delta))
    : []

  for (const metric of COMPARISON_METRICS) {
    const delta = deltas.find((item) => item.metric === metric.key && item.state === 'complete')
    if (!delta) continue

    const current = typeof delta.current === 'string' ? delta.current : null
    const baseline = typeof delta.baseline === 'string' ? delta.baseline : null
    if (!current || !baseline) continue

    const currency = typeof record.currency === 'string' ? record.currency : envelopeCurrency
    if (metric.unit === 'currency' && !currency) continue

    const currentValue = toScaleValue(current)
    const baselineValue = toScaleValue(baseline)
    if (currentValue === null || baselineValue === null) continue

    const currentLabel = labels?.current && labels.current.trim() ? labels.current : 'Période demandée'
    const baselineLabel = labels?.baseline && labels.baseline.trim() ? labels.baseline : 'Période de référence'
    const unitCurrency = metric.unit === 'currency' ? currency : null

    return {
      title: `Comparaison — ${metric.label}`,
      description: `${currentLabel} comparé à ${baselineLabel}. Barres issues des valeurs vérifiées de chaque période.`,
      type: 'bar',
      unit: metric.unit,
      points: [
        {
          label: baselineLabel,
          value: baselineValue,
          valueLabel: exactLabel(baseline, unitCurrency),
          currency: currency ?? '',
          storeId: 'comparison',
        },
        {
          label: currentLabel,
          value: currentValue,
          valueLabel: exactLabel(current, unitCurrency),
          currency: currency ?? '',
          storeId: 'comparison',
        },
      ],
      warnings: [],
    }
  }

  return null
}

function chartToResponse(chart: ChartResult, currency: string | null): AssistantStructuredResponse {
  const xKey = chart.type === 'line' ? 'date' : 'name'
  return {
    message_text: '',
    chart: true,
    chart_type: chart.type,
    chart_unit: chart.unit,
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
  /** Libellé de période déjà résolu côté serveur. */
  rangeLabel?: string
  comparison?: unknown
  comparisonLabels?: { current?: string; baseline?: string } | null
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
  const rangeLabel = typeof record.rangeLabel === 'string' ? record.rangeLabel : null

  // Aucun graphique sur une donnée absente ou interdite.
  if (envelope && BLOCKED_STATES.has(envelope.state)) return base

  // Sélection déterministe côté serveur : chaque graphique n'est construit
  // qu'à partir d'un agrégat validé, puis ordonné selon la question posée.
  const periodSuffix = rangeLabel ? ` — ${rangeLabel}` : ''

  const dailyChart = buildDailyChart(
    record.daily,
    envelope?.currency ?? null,
    envelopeStoreId,
    rangeLabel,
  )

  const productChart = buildSectionChart(record.products, {
    title: 'Produits par chiffre d’affaires',
    description: `Classement borné${periodSuffix} : la somme des produits affichés n’est pas le CA total.`,
    labelField: 'productName',
  })

  const cityChart = buildSectionChart(record.cities, {
    title: 'Chiffre d’affaires par ville',
    description: `Part du CA réalisé par ville${periodSuffix}.`,
    labelField: 'city',
  })

  const comparisonLabels = asRecord(record.comparisonLabels)
  const comparisonChart = buildComparisonChart(
    record.comparison,
    comparisonLabels
      ? {
          current: typeof comparisonLabels.current === 'string' ? comparisonLabels.current : undefined,
          baseline: typeof comparisonLabels.baseline === 'string' ? comparisonLabels.baseline : undefined,
        }
      : null,
    envelope?.currency ?? null,
  )

  const priority: Partial<Record<AssistantIntent, Array<ChartResult | null>>> = {
    period_comparison: [comparisonChart, dailyChart, cityChart, productChart],
    top_products: [productChart, dailyChart, cityChart],
    profit_analysis: [productChart, dailyChart],
    performance_request: [cityChart, dailyChart, productChart],
    chart_request: [dailyChart, cityChart, productChart],
    dashboard_summary: [dailyChart, productChart, cityChart],
  }

  const chart = (priority[intent] ?? [dailyChart]).find((candidate): candidate is ChartResult => Boolean(candidate)) ?? null
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
