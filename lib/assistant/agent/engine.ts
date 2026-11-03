/**
 * Moteur analytique V2.
 *
 * Chaîne complète, dans cet ordre :
 * 1. interprétation structurée (périodes multiples, métriques, dimensions) ;
 * 2. plan d'opérations borné ;
 * 3. lectures contrôlées (lecteurs existants uniquement) ;
 * 4. qualification de chaque fenêtre (donnée réelle / absente / illisible) ;
 * 5. comparabilité **par métrique** ;
 * 6. composition de blocs typés et localisés ;
 * 7. une seule rédaction optionnelle par le modèle, adossée aux faits.
 *
 * Le modèle ne produit jamais de chiffre : les valeurs viennent des blocs
 * calculés ici. Si le fournisseur échoue, la réponse factuelle est publiée
 * seule — jamais une erreur globale.
 */
import type { AnalyticsMetric, KpiMetricAlias } from '@/lib/assistant/analytics-contract'
import { ALL_METRICS } from '@/lib/assistant/semantic/catalog'
import { buildAnalysisRequest, planWindows, type AnalysisRequest } from '@/lib/assistant/semantic/request'
import { periodDays } from '@/lib/assistant/semantic/periods'
import {
  decideComparability,
  type MetricDeltaResult,
  type PeriodSideInput,
} from '@/lib/assistant/semantic/comparability'
import { resolveAssistantBusinessRange } from '@/lib/assistant/analytics-reader'
import { createBudgetTracker, DEFAULT_BUDGETS, EngineBudgetError, isDeepeningEnabled, isNarrativeEnabled } from '@/lib/assistant/engine/policy'
import { readDimension, readWindows, type DimensionReading, type WindowReading } from '@/lib/assistant/engine/executor'
import { assessWindow, type WindowAssessment } from '@/lib/assistant/engine/history'
import { composeDocument, readMetricFromReading, type ComposedResponse } from '@/lib/assistant/blocks/compose'
import { resolveDictionary, translate } from '@/lib/assistant/blocks/i18n'
import { sanitizePublicText, sanitizeWarnings } from '@/lib/assistant/blocks/sanitize'
import type { ResponseDocument } from '@/lib/assistant/blocks/types'
import { getAssistantProvider } from '@/lib/assistant/providers'
import type { AssistantStructuredResponse } from '@/lib/assistant/types'
import type { RunSecureAgentInput, RunSecureAgentOutput, AgentStep } from '@/lib/assistant/agent/types'

/** Nombre maximal de fenêtres réellement lues pour une demande. */
export const ENGINE_MAX_WINDOWS = DEFAULT_BUDGETS.maxWindowReads

export interface EngineOutcome {
  structuredResponse: AssistantStructuredResponse
  providerUsage: RunSecureAgentOutput['providerUsage']
  activitySteps: AgentStep[]
}

/** Convertit une fenêtre lue en entrée de comparabilité. */
export function sideInputFromReading(
  reading: WindowReading | undefined,
  days: number,
): PeriodSideInput {
  const metrics: Partial<Record<KpiMetricAlias, AnalyticsMetric | null>> = {}
  for (const alias of ALL_METRICS) {
    const snapshot = readMetricFromReading(reading, alias)
    metrics[alias] = snapshot.value === null
      ? null
      : {
          value: snapshot.value,
          count: snapshot.unit === 'count' ? Number(snapshot.value) : null,
          unit: snapshot.unit,
          state: snapshot.state,
          definition: '',
          numerator: null,
          denominator: null,
        }
  }

  const versions = new Set(
    (reading?.kpis?.stores ?? []).map((store) => store.definitionVersion),
  )

  return {
    metrics,
    state: reading?.kpis?.state ?? 'missing',
    days,
    definitionVersion: versions.size === 1 ? Array.from(versions)[0] : null,
  }
}

/** Série journalière réellement exploitable pour un graphique. */
export function hasDailySeries(reading: WindowReading | undefined): boolean {
  const stores = reading?.kpis?.stores ?? []
  if (stores.length !== 1) return false
  return (stores[0].days ?? []).filter((day) => day.state === 'complete' || day.state === 'empty').length >= 3
}

/** Suggestions localisées : uniquement des capacités réellement disponibles. */
export function buildSuggestions(locale: AssistantRequestLocale, script: 'latin' | 'arabic'): string[] {
  const dict = resolveDictionary(locale, script)
  const keys = ['suggest.analyze', 'suggest.compare', 'suggest.cities']
  return keys.map((key) => translate(dict, key)).filter(Boolean)
}

type AssistantRequestLocale = AnalysisRequest['profile']['locale']

/** Message de clarification : aucune lecture n'est lancée. */
export function clarificationOutcome(request: AnalysisRequest): EngineOutcome {
  const dict = resolveDictionary(request.profile.locale, request.profile.script)
  const question = translate(dict, 'clarify.period')
  const document: ResponseDocument = {
    version: 1,
    locale: request.profile.locale,
    script: request.profile.script,
    direction: request.profile.direction,
    presentation: 'short',
    blocks: [{ type: 'clarification', question }],
  }
  return {
    structuredResponse: {
      message_text: question,
      warnings: [],
      metrics_summary: [],
      chart: false,
      document,
    },
    providerUsage: emptyUsage(),
    activitySteps: [{ label: 'Clarification', detail: 'période non déterminée' }],
  }
}

/** Usage neutre : aucune inférence n'a été facturée. */
function emptyUsage() {
  return {
    text: '',
    inputTokens: 0,
    outputTokens: 0,
    providerName: 'engine',
    modelName: 'deterministic',
    providerCostUsd: 0,
  }
}

/* -------------------------------------------------------------------------- */
/* Rédaction optionnelle, strictement encadrée                                */
/* -------------------------------------------------------------------------- */

const NARRATIVE_HINT: Record<string, string> = {
  fr: 'Écris une phrase de synthèse en français, sans aucun chiffre.',
  ar: 'اكتب جملة تلخيصية بالعربية، بدون أي أرقام.',
  darija: 'Kteb joumla 9sira b darija, bla 7ta ra9m.',
  en: 'Write one summary sentence in English, without any number.',
}

/**
 * Demande une phrase de synthèse au modèle.
 *
 * Contraintes non négociables : aucune valeur numérique dans le texte produit
 * (elles vivent dans les blocs), et un échec du fournisseur ne dégrade jamais
 * la réponse factuelle.
 */
export async function requestNarrative(input: {
  request: AnalysisRequest
  composed: ComposedResponse
  model: string
  signal?: AbortSignal
  maxOutputTokens?: number
}): Promise<{ text: string; usage: RunSecureAgentOutput['providerUsage'] }> {
  const dict = resolveDictionary(input.request.profile.locale, input.request.profile.script)
  const labels = [
    ...input.composed.kpiItems.map((item) => item.label),
    ...(input.composed.table?.columns.map((column) => column.label) ?? []),
  ]

  const systemPrompt = [
    'Tu es un analyste e-commerce COD.',
    NARRATIVE_HINT[input.request.profile.locale] ?? NARRATIVE_HINT.fr,
    'Interdiction absolue : aucun nombre, aucun montant, aucun pourcentage.',
    'Ne cite pas de cause non démontrée : reste factuel et prudent.',
    'Réponds uniquement en JSON valide : {"summary":"..."}.',
  ].join('\n')

  const userPrompt = [
    `Indicateurs disponibles : ${labels.join(', ') || translate(dict, 'summary.noFigures')}`,
    `Comparaison : ${input.composed.table ? 'oui' : 'non'}`,
    `Question : ${input.request.question.slice(0, 400)}`,
  ].join('\n')

  try {
    const provider = getAssistantProvider()
    const result = await provider.chat({
      model: input.model,
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      signal: input.signal,
      maxOutputTokens: Math.min(input.maxOutputTokens ?? 160, 200),
    })
    const summary = extractNarrative(result.text)
    return {
      text: summary,
      usage: {
        text: result.text,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        providerName: result.providerName,
        modelName: result.modelName,
        providerCostUsd: result.providerCostUsd,
      },
    }
  } catch {
    return { text: '', usage: emptyUsage() }
  }
}

/** Extrait la phrase de synthèse et supprime toute trace de chiffre. */
export function extractNarrative(raw: string): string {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  let candidate = text
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as { summary?: unknown }
      if (typeof parsed.summary === 'string') candidate = parsed.summary
    } catch {
      candidate = text
    }
  }
  // Aucun chiffre dans la narration : les valeurs sont dans les blocs.
  const cleaned = sanitizePublicText(candidate.replace(/\d+([.,]\d+)*/g, ' ')).text
  return cleaned.slice(0, 320)
}

/* -------------------------------------------------------------------------- */
/* Exécution                                                                  */
/* -------------------------------------------------------------------------- */

/** Accès effectif le plus restrictif observé sur les lectures. */
export function effectiveAccess(readings: Iterable<WindowReading>): 'full' | 'commercial' {
  for (const reading of readings) {
    for (const store of reading.kpis?.stores ?? []) {
      if (store.access === 'commercial') return 'commercial'
    }
  }
  return 'full'
}

/** Paire réellement exploitable : celle qui publie le plus de valeurs. */
export function choosePrimaryPair(
  pairs: ReadonlyArray<{ currentId: string; baselineId: string }>,
  assessments: Map<string, WindowAssessment>,
): { currentId: string; baselineId: string } | null {
  let best: { currentId: string; baselineId: string } | null = null
  let bestScore = -1

  for (const pair of pairs) {
    const current = assessments.get(pair.currentId)
    const baseline = assessments.get(pair.baselineId)
    const score = (current?.publishedMetrics.length ?? 0) + (baseline?.publishedMetrics.length ?? 0)
    const comparable = (current?.comparable ?? false) && (baseline?.comparable ?? false)
    const weighted = comparable ? score + 100 : score
    if (weighted > bestScore) {
      bestScore = weighted
      best = pair
    }
  }
  return best
}

/**
 * Exécute l'analyse complète.
 *
 * Ne lève jamais pour un motif métier : une période inexploitable, un budget
 * atteint ou une lecture en échec produisent une réponse explicite.
 */
export async function runAnalyticEngine(input: RunSecureAgentInput): Promise<EngineOutcome> {
  const activitySteps: AgentStep[] = []
  const profile = {
    locale: (input.language === 'ar' ? 'ar' : 'fr') as 'ar' | 'fr',
    script: (input.language === 'ar' ? 'arabic' : 'latin') as 'arabic' | 'latin',
  }

  let resolvedRange
  try {
    resolvedRange = resolveAssistantBusinessRange(input.range)
  } catch {
    return failureOutcome(profile.locale, profile.script, 'absence.range')
  }

  const request: AnalysisRequest = buildAnalysisRequest({
    message: input.userMessage,
    intent: input.intent,
    resolvedRange,
    resolvedComparison: input.comparisonBaseline
      ? { current: resolvedRange, baseline: input.comparisonBaseline }
      : null,
    access: 'full',
    maxPeriods: DEFAULT_BUDGETS.maxPeriods,
  })

  if (request.clarification) return clarificationOutcome(request)

  activitySteps.push({
    label: 'Périodes',
    detail: `${request.plan.periods.length} fenêtre(s), ${request.plan.pairs.length} correspondance(s)`,
  })

  const tracker = createBudgetTracker()
  let budgetExceeded = false

  // Bornage strict : le plan ne peut pas dépasser le budget de lectures.
  const windows = planWindows(request.plan).slice(0, ENGINE_MAX_WINDOWS)
  let readings = new Map<string, WindowReading>()
  try {
    readings = await readWindows({
      supabase: input.supabase,
      storeIds: input.scopeStoreIds,
      windows,
      tracker,
      signal: input.signal,
    })
  } catch (error) {
    if (error instanceof EngineBudgetError) budgetExceeded = true
    else throw error
  }

  const assessments = new Map<string, WindowAssessment>()
  for (const window of windows) {
    assessments.set(window.id, assessWindow(readings.get(window.id), { budgetExceeded }))
  }

  const access = effectiveAccess(readings.values())
  const financial = new Set<KpiMetricAlias>([
    'purchaseCost', 'deliveryCost', 'confirmationCost', 'contributionMargin',
  ])
  const metrics = request.metrics.filter((metric) => access === 'full' || !financial.has(metric))
  const scopedRequest: AnalysisRequest = { ...request, metrics, access }

  const primaryPair = choosePrimaryPair(request.plan.pairs, assessments)
  const currentPeriodId = primaryPair?.currentId ?? request.plan.periods[0]?.id ?? null
  const baselinePeriodId = primaryPair?.baselineId ?? null

  const findPeriod = (id: string | null) =>
    id
      ? request.plan.periods.find((period) => period.id === id) ??
        request.plan.groups.find((period) => period.id === id) ?? null
      : null

  const currentPeriod = findPeriod(currentPeriodId)
  const baselinePeriod = findPeriod(baselinePeriodId)

  let deltas: MetricDeltaResult[] = []
  if (baselinePeriod && currentPeriod) {
    deltas = decideComparability({
      metrics,
      current: sideInputFromReading(readings.get(currentPeriod.id), periodDays(currentPeriod)),
      baseline: sideInputFromReading(readings.get(baselinePeriod.id), periodDays(baselinePeriod)),
      access,
    })
  }

  // Dimensions : lues sur la fenêtre courante, plafonnées par le budget.
  const dimensions: DimensionReading[] = []
  const primaryReading = currentPeriodId ? readings.get(currentPeriodId) : undefined
  if (primaryReading && isDeepeningEnabled()) {
    for (const dimension of scopedRequest.dimensions.slice(0, DEFAULT_BUDGETS.maxDimensions)) {
      tracker.assertTime()
      dimensions.push(await readDimension({
        supabase: input.supabase,
        dimension,
        reading: primaryReading,
        tracker,
      }))
    }
  }

  const currency = primaryReading
    ? readMetricFromReading(primaryReading, 'revenue').currency
    : null

  const composed = composeDocument({
    request: scopedRequest,
    readings,
    assessments,
    deltas,
    primaryPair: primaryPair
      ? { currentId: primaryPair.currentId, baselineId: primaryPair.baselineId }
      : null,
    dimensions,
    currency,
    budgetExceeded,
  })

  activitySteps.push({
    label: 'Composition',
    detail: `${composed.document.blocks.length} bloc(s)`,
  })

  // Rédaction optionnelle : parité de facturation avec le moteur historique.
  // Le texte du modèle ne remplace le résumé que s'il ne contient aucun chiffre
  // et aucun code interne ; sinon le résumé déterministe reste publié.
  let structured = toStructuredResponse(composed, scopedRequest)
  if (isNarrativeEnabled()) {
    const hasFigures = Boolean(composed.table) || composed.kpiItems.length > 0 || Boolean(composed.chart)
    const narrative = hasFigures
      ? await requestNarrative({
          request: scopedRequest,
          composed,
          model: input.providerModel,
          signal: input.signal,
          maxOutputTokens: input.maxOutputTokens,
        })
      : null

    if (narrative && narrative.text && isSafeNarrative(narrative.text)) {
      structured = applyNarrative(structured, narrative.text)
      return {
        structuredResponse: structured,
        providerUsage: narrative.usage,
        activitySteps,
      }
    }
    if (narrative) {
      return { structuredResponse: structured, providerUsage: narrative.usage, activitySteps }
    }
  }

  return {
    structuredResponse: structured,
    providerUsage: emptyUsage(),
    activitySteps,
  }
}

/** Une narration ne doit jamais réintroduire de chiffre ni de code technique. */
export function isSafeNarrative(text: string): boolean {
  const candidate = String(text ?? '').trim()
  if (!candidate || candidate.length > 320) return false
  if (/\d/.test(candidate)) return false
  return sanitizePublicText(candidate).removedCode === false
}

/** Remplace le résumé par la narration, sans toucher aux blocs chiffrés. */
export function applyNarrative(
  response: AssistantStructuredResponse,
  narrative: string,
): AssistantStructuredResponse {
  const document = response.document
  if (!document) return { ...response, message_text: narrative }
  return {
    ...response,
    message_text: narrative,
    document: {
      ...document,
      blocks: document.blocks.map((block) =>
        block.type === 'summary' ? { ...block, text: narrative } : block,
      ),
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Projection vers le contrat historique                                      */
/* -------------------------------------------------------------------------- */

/**
 * Projette les blocs vers `AssistantStructuredResponse`.
 *
 * Le document typé est la source ; les champs historiques sont dérivés pour
 * que les anciens messages et les composants existants restent fonctionnels.
 */
export function toStructuredResponse(
  composed: ComposedResponse,
  request: AnalysisRequest,
): AssistantStructuredResponse {
  const warnings = sanitizeWarnings(composed.warnings)
  const chart = composed.chart
  const table = composed.table
  const seriesKey = chart ? Object.keys(chart.points[0]?.values ?? {})[0] : undefined

  return {
    message_text: sanitizePublicText(composed.text).text,
    document: composed.document,
    warnings,
    metrics_summary: composed.kpiItems.map((item) => ({ label: item.label, value: item.value })),
    chart: Boolean(chart),
    chart_type: chart ? chart.kind : undefined,
    chart_unit: chart?.unit,
    chart_title: chart?.title,
    chart_data: chart && seriesKey
      ? chart.points.map((point) => ({
          date: point.x,
          value: point.values[seriesKey] ?? null,
          valueLabel: point.values[seriesKey] === null || point.values[seriesKey] === undefined
            ? ''
            : String(point.values[seriesKey]),
        }))
      : undefined,
    comparison_table: table
      ? {
          currentLabel: table.columns[1]?.label ?? '',
          baselineLabel: table.columns[2]?.label ?? '',
          rows: table.rows.map((row) => ({
            label: row.cells[0]?.value ?? '',
            current: row.cells[1]?.value ?? '',
            baseline: row.cells[2]?.value ?? '',
            delta: row.cells[3]?.value ?? '',
          })),
        }
      : undefined,
    suggestions: buildSuggestions(request.profile.locale, request.profile.script),
  }
}

/** Réponse de repli : une limite explicite, jamais une erreur technique. */
export function failureOutcome(
  locale: AnalysisRequest['profile']['locale'],
  script: 'latin' | 'arabic',
  key: string,
): EngineOutcome {
  const dict = resolveDictionary(locale, script)
  const message = translate(dict, key) || translate(dict, 'summary.noFigures')
  const document: ResponseDocument = {
    version: 1,
    locale,
    script,
    direction: script === 'arabic' ? 'rtl' : 'ltr',
    presentation: 'short',
    blocks: [{ type: 'notice', severity: 'warning', text: message }],
  }

  return {
    structuredResponse: {
      message_text: message,
      warnings: [message],
      metrics_summary: [],
      chart: false,
      document,
    },
    providerUsage: emptyUsage(),
    activitySteps: [{ label: 'Limite', detail: key }],
  }
}
