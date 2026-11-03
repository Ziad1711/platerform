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
import { ALL_METRICS, isMetricAllowed, restrictMetrics } from '@/lib/assistant/semantic/catalog'
import { buildAnalysisRequest, planWindows, type AnalysisRequest } from '@/lib/assistant/semantic/request'
import { periodDays } from '@/lib/assistant/semantic/periods'
import { detectCommunicationProfile } from '@/lib/assistant/semantic/locale'
import { decideComparability, type PeriodSideInput } from '@/lib/assistant/semantic/comparability'
import { resolveAssistantBusinessRange } from '@/lib/assistant/analytics-reader'
import { businessTodayIso } from '@/lib/dashboard/business-time'
import {
  createBudgetTracker,
  DEFAULT_BUDGETS,
  EngineBudgetError,
  isDeepeningEnabled,
  isNarrativeEnabled,
  isPlannerLlmEnabled,
} from '@/lib/assistant/engine/policy'
import { readDimension, readWindows, isDimensionSupported, type DimensionReading, type WindowReading } from '@/lib/assistant/engine/executor'
import { assessWindow, type WindowAssessment } from '@/lib/assistant/engine/history'
import { composeDocument, readMetricFromReading, type ComparisonSection, type ComposedResponse } from '@/lib/assistant/blocks/compose'
import { resolveDictionary, translate } from '@/lib/assistant/blocks/i18n'
import { sanitizePublicText, sanitizeWarnings } from '@/lib/assistant/blocks/sanitize'
import type { ResponseDocument } from '@/lib/assistant/blocks/types'
import { getAssistantProvider } from '@/lib/assistant/providers'
import { requestDynamicPlan, type DynamicPlan } from '@/lib/assistant/agent/planner'
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
    endsAt: reading?.range?.to ?? null,
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
 * Demande une phrase de synthèse au modèle, adossée à des faits.
 *
 * Le modèle reçoit les valeurs exactes et les réserves : il peut raisonner,
 * mais le texte final est validé (`isGroundedNarrative`). Un échec fournisseur
 * ne dégrade jamais la réponse factuelle ; une annulation est propagée.
 */
export async function requestNarrative(input: {
  request: AnalysisRequest
  facts: readonly string[]
  model: string
  signal?: AbortSignal
  maxOutputTokens?: number
}): Promise<{ text: string; usage: RunSecureAgentOutput['providerUsage'] }> {
  const systemPrompt = [
    'Tu es un analyste e-commerce COD.',
    NARRATIVE_HINT[input.request.profile.locale] ?? NARRATIVE_HINT.fr,
    'Interdiction absolue : aucun nombre, aucun montant, aucun pourcentage.',
    'Interdiction absolue : aucune cause, aucune explication causale, aucune hypothèse présentée comme un fait.',
    'Appuie chaque phrase sur les faits fournis ; ne propose que des constats et des vérifications à faire.',
    'Réponds uniquement en JSON valide : {"summary":"..."}.',
  ].join('\n')

  const userPrompt = [
    'Faits vérifiés (format : indicateur | période=valeur | écart) :',
    ...input.facts.map((fact) => `- ${fact}`),
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
    if (input.signal?.aborted) throw new Error('ASSISTANT_ABORTED')
    return {
      text: extractNarrative(result.text),
      usage: {
        text: result.text,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        providerName: result.providerName,
        modelName: result.modelName,
        providerCostUsd: result.providerCostUsd,
      },
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    // Une annulation n'est pas un échec fournisseur : elle est propagée pour
    // empêcher toute finalisation après abandon.
    if (input.signal?.aborted || code === 'ASSISTANT_ABORTED' || code.endsWith('_ABORTED')) {
      throw new Error('ASSISTANT_ABORTED')
    }
    return { text: '', usage: emptyUsage() }
  }
}

/**
 * Extrait la phrase de synthèse **sans la nettoyer**.
 *
 * Le texte brut est conservé : c'est au validateur de rejeter une narration qui
 * contient des chiffres. Supprimer les nombres avant validation masquait le
 * défaut au lieu de le corriger.
 */
export function extractNarrative(raw: string): string {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as { summary?: unknown }
      if (typeof parsed.summary === 'string') return parsed.summary.trim().slice(0, 400)
    } catch {
      return text.slice(0, 400)
    }
  }
  return text.slice(0, 400)
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
 * Applique un plan validé au plan déterministe.
 *
 * Les métriques du plan passent en tête, mais les indicateurs explicitement
 * demandés et la sélection par défaut sont conservés : un plan incomplet ne peut
 * pas faire disparaître la métrique qui a motivé la question.
 */
export function applyDynamicPlan(base: AnalysisRequest, plan: DynamicPlan | null): AnalysisRequest {
  if (!plan) return base
  const merged: AnalysisRequest['metrics'] = []
  for (const metric of [...plan.metrics, ...base.requestedMetrics, ...base.metrics]) {
    if (!merged.includes(metric) && isMetricAllowed(metric, base.access)) merged.push(metric)
  }
  const dimensions = plan.dimensions.length > 0
    ? plan.dimensions.filter((dimension) => isDimensionSupported(dimension))
    : base.dimensions
  return {
    ...base,
    metrics: merged.length > 0 ? merged : base.metrics,
    dimensions,
    needsSeries: base.needsSeries || plan.needsSeries,
  }
}

function findPeriodInPlan(plan: AnalysisRequest['plan'], id: string) {
  return plan.periods.find((period) => period.id === id) ??
    plan.groups.find((period) => period.id === id) ?? null
}

/** Construit TOUTES les comparaisons du plan, sans en omettre aucune. */
export function buildSections(input: {
  request: AnalysisRequest
  readings: Map<string, WindowReading>
  today?: string | null
}): ComparisonSection[] {
  const sections: ComparisonSection[] = []
  for (const pair of input.request.plan.pairs) {
    const currentPeriod = findPeriodInPlan(input.request.plan, pair.currentId)
    const baselinePeriod = findPeriodInPlan(input.request.plan, pair.baselineId)
    if (!currentPeriod || !baselinePeriod) continue
    sections.push({
      currentId: pair.currentId,
      baselineId: pair.baselineId,
      deltas: decideComparability({
        metrics: input.request.metrics,
        current: sideInputFromReading(input.readings.get(pair.currentId), periodDays(currentPeriod)),
        baseline: sideInputFromReading(input.readings.get(pair.baselineId), periodDays(baselinePeriod)),
        access: input.request.access,
        today: input.today,
      }),
    })
  }
  return sections
}

/**
 * Faits structurés transmis au rédacteur.
 *
 * Le modèle reçoit les valeurs exactes et les réserves : il peut raisonner sans
 * les inventer, et le validateur peut ensuite vérifier qu'il n'a pas ajouté de
 * chiffre ni de causalité.
 */
export function buildFactsDigest(input: {
  request: AnalysisRequest
  readings: Map<string, WindowReading>
  sections: readonly ComparisonSection[]
}): string[] {
  const dict = resolveDictionary(input.request.profile.locale, input.request.profile.script)
  const lines: string[] = []
  for (const section of input.sections) {
    const currentPeriod = findPeriodInPlan(input.request.plan, section.currentId)
    const baselinePeriod = findPeriodInPlan(input.request.plan, section.baselineId)
    if (!currentPeriod || !baselinePeriod) continue
    const currentLabel = describePeriod(currentPeriod, input.request.profile.locale)
    const baselineLabel = describePeriod(baselinePeriod, input.request.profile.locale)
    for (const delta of section.deltas) {
      if (delta.current === null && delta.baseline === null) continue
      const label = translate(dict, `metric.${delta.metric}`)
      const direction = delta.direction ?? 'na'
      lines.push(`${label} | ${currentLabel}=${delta.current ?? 'n/a'} | ${baselineLabel}=${delta.baseline ?? 'n/a'} | ecart=${delta.delta ?? 'n/a'} (${direction})`)
      if (lines.length >= 24) return lines
    }
  }
  return lines
}

/** Marqueurs causaux : jamais acceptés sans démonstration. */
const CAUSAL_MARKER = /(?:parce\s+que|à\s+cause|a\s+cause|en\s+raison|caus[ée]e?s?|explique[nt]?|dû\s+à|due\s+to|because|caused|explains|بسبب|لأن|يعود\s+إلى)/i

/**
 * Une narration est publiable seulement si elle reste factuelle.
 *
 * Contraintes : aucun chiffre (ils vivent dans les blocs), aucune causalité non
 * démontrée, aucun code interne, et au moins un fait disponible.
 */
export function isGroundedNarrative(text: string, facts: readonly string[]): boolean {
  const candidate = String(text ?? '').trim()
  if (!candidate || candidate.length > 360) return false
  if (facts.length === 0) return false
  if (/\d/.test(candidate)) return false
  if (CAUSAL_MARKER.test(candidate)) return false
  return sanitizePublicText(candidate).removedCode === false
}

/** Libellé de période, identique à celui des blocs. */
function describePeriod(period: { months: Array<{ year: number; month: number }>; range: { from: string; to: string }; year: number | null }, locale: AnalysisRequest['profile']['locale']): string {
  if (period.months.length > 0) {
    const first = period.months[0]
    if (period.months.length === 1) {
      const label = new Date(Date.UTC(first.year, first.month - 1, 1))
        .toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      return label
    }
    return `${period.range.from}..${period.range.to}`
  }
  return `${period.range.from}..${period.range.to}`
}

/**
 * Exécute l'analyse complète.
 *
 * Ne lève jamais pour un motif métier : une période inexploitable, un budget
 * atteint ou une lecture en échec produisent une réponse explicite.
 */
export async function runAnalyticEngine(input: RunSecureAgentInput): Promise<EngineOutcome> {
  const activitySteps: AgentStep[] = []
  const detected = detectCommunicationProfile(input.userMessage)
  const profile = { locale: detected.locale, script: detected.script }

  let resolvedRange
  try {
    resolvedRange = resolveAssistantBusinessRange(input.range)
  } catch {
    return failureOutcome(profile.locale, profile.script, 'absence.range')
  }

  if (input.signal?.aborted) throw new Error('ASSISTANT_ABORTED')

  // 1. Interprétation déterministe : toujours disponible, jamais supprimée.
  const deterministic: AnalysisRequest = buildAnalysisRequest({
    message: input.userMessage,
    intent: input.intent,
    resolvedRange,
    resolvedComparison: input.comparisonBaseline
      ? { current: resolvedRange, baseline: input.comparisonBaseline }
      : null,
    access: 'full',
    maxPeriods: DEFAULT_BUDGETS.maxPeriods,
  })

  if (deterministic.clarification) return clarificationOutcome(deterministic)

  // 2. Planification dynamique bornée : le modèle propose, le backend dispose.
  let plannerUsage: RunSecureAgentOutput['providerUsage'] | null = null
  let plan: DynamicPlan | null = null
  if (isPlannerLlmEnabled()) {
    const planned = await requestDynamicPlan({
      message: input.userMessage,
      locale: deterministic.profile.locale,
      context: {
        allowedMetrics: restrictMetrics(ALL_METRICS, deterministic.access),
        allowedDimensions: ['city', 'product', 'agent', 'status', 'confirmation'],
      },
      financialAccess: deterministic.access,
      model: input.providerModel,
      signal: input.signal,
    })
    plan = planned.plan
    plannerUsage = planned.usage
    activitySteps.push({
      label: 'Plan',
      detail: plan
        ? `${plan.metrics.length} métrique(s), ${plan.dimensions.length} dimension(s)`
        : `repli déterministe (${planned.reason})`,
    })
  }

  const request: AnalysisRequest = applyDynamicPlan(deterministic, plan)

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

  if (input.signal?.aborted) throw new Error('ASSISTANT_ABORTED')

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

  // TOUTES les comparaisons du plan sont construites : aucune période citée
  // n'est supprimée par un choix de « paire principale ».
  const today = businessTodayIso()
  const sections: ComparisonSection[] = buildSections({ request: scopedRequest, readings, today })
  const primarySection = sections[0] ?? null
  const primaryReading = primarySection
    ? readings.get(primarySection.currentId)
    : (request.plan.periods[0] ? readings.get(request.plan.periods[0].id) : undefined)

  // Approfondissement borné : une ventilation n'est lue que si elle est
  // demandée, que la fenêtre principale existe et que le budget le permet.
  const dimensions: DimensionReading[] = []
  if (primaryReading && scopedRequest.dimensions.length > 0 && isDeepeningEnabled()) {
    const nothingPublished = primarySection
      ? primarySection.deltas.every((delta) => delta.current === null && delta.baseline === null)
      : false
    for (const dimension of scopedRequest.dimensions.slice(0, DEFAULT_BUDGETS.maxDimensions)) {
      if (input.signal?.aborted) throw new Error('ASSISTANT_ABORTED')
      if (!tracker.canContinue()) {
        budgetExceeded = true
        break
      }
      if (!isDimensionSupported(dimension)) {
        // Capacité non exposée : elle est signalée, jamais inventée.
        dimensions.push({ dimension, windowId: primaryReading.windowId, data: null, failure: 'unknown' })
        continue
      }
      try {
        if (nothingPublished) tracker.consumeDeepening()
        dimensions.push(await readDimension({
          supabase: input.supabase,
          dimension,
          reading: primaryReading,
          tracker,
        }))
      } catch (error) {
        if (error instanceof EngineBudgetError) {
          budgetExceeded = true
          break
        }
        throw error
      }
    }
  }

  const currency = primaryReading
    ? readMetricFromReading(primaryReading, 'revenue').currency
    : null

  const composed = composeDocument({
    request: scopedRequest,
    readings,
    assessments,
    sections,
    dimensions,
    currency,
    budgetExceeded,
  })

  activitySteps.push({
    label: 'Composition',
    detail: `${composed.document.blocks.length} bloc(s)`,
  })

  // Rédaction optionnelle adossée aux faits : le texte ne remplace le résumé
  // déterministe que s'il reste strictement factuel (aucun chiffre, aucune
  // causalité non démontrée, aucun code interne).
  let structured = toStructuredResponse(composed, scopedRequest)
  const facts = buildFactsDigest({ request: scopedRequest, readings, sections })
  let narrativeUsage: RunSecureAgentOutput['providerUsage'] | null = null

  if (isNarrativeEnabled() && facts.length > 0) {
    const hasFigures = composed.tables.length > 0 || composed.kpiItems.length > 0 || Boolean(composed.chart)
    const narrative = hasFigures
      ? await requestNarrative({
          request: scopedRequest,
          facts,
          model: input.providerModel,
          signal: input.signal,
          maxOutputTokens: input.maxOutputTokens,
        })
      : null
    if (narrative) {
      narrativeUsage = narrative.usage
      if (narrative.text && isGroundedNarrative(narrative.text, facts)) {
        structured = applyNarrative(structured, narrative.text)
      }
    }
  }

  return {
    structuredResponse: structured,
    providerUsage: mergeUsage(plannerUsage, narrativeUsage),
    activitySteps,
  }
}

/** Somme d'usages mesurés : les tokens de chaque appel réel sont conservés. */
export function mergeUsage(
  ...usages: Array<RunSecureAgentOutput['providerUsage'] | null | undefined>
): RunSecureAgentOutput['providerUsage'] {
  const real = usages.filter((usage): usage is RunSecureAgentOutput['providerUsage'] => Boolean(usage))
    .filter((usage) => usage.providerName !== 'engine')
  if (real.length === 0) return emptyUsage()
  const last = real[real.length - 1]
  return {
    text: last.text,
    inputTokens: real.reduce((sum, usage) => sum + usage.inputTokens, 0),
    outputTokens: real.reduce((sum, usage) => sum + usage.outputTokens, 0),
    providerName: last.providerName,
    modelName: last.modelName,
    providerCostUsd: real.reduce((sum, usage) => sum + usage.providerCostUsd, 0),
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
