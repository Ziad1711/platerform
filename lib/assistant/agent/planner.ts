/**
 * Planification dynamique bornée.
 *
 * Le modèle **propose** un plan ; il ne l'exécute jamais. Le backend valide
 * chaque opération contre le catalogue autorisé, refuse tout ce qui sort du
 * périmètre et retombe sur le plan déterministe si la réponse est invalide.
 *
 * Aucun SQL, aucun nom de table, aucun budget ne vient du modèle : seuls des
 * identifiants de métrique et de dimension déjà connus sont acceptés.
 *
 * Le coût est borné par construction : un seul appel, un plafond de tokens
 * court, un nombre d'opérations maximal et aucune boucle autonome.
 */
import type { KpiMetricAlias } from '@/lib/assistant/analytics-contract'
import type { AnalysisDimension } from '@/lib/assistant/semantic/request'
import type { AssistantLocale } from '@/lib/assistant/semantic/locale'
import type { AssistantProviderOutput } from '@/lib/assistant/providers/types'

/** Version du schéma de plan échangé avec le modèle. */
export const PLAN_SCHEMA_VERSION = 1
/** Métriques maximales retenues d'un plan. */
export const MAX_PLANNED_METRICS = 8
/** Dimensions maximales retenues d'un plan. */
export const MAX_PLANNED_DIMENSIONS = 3
/** Opérations maximales acceptées (métriques + dimensions confondues). */
export const MAX_PLANNED_OPERATIONS = 11

export interface DynamicPlan {
  schema: number
  metrics: KpiMetricAlias[]
  dimensions: AnalysisDimension[]
  needsSeries: boolean
  /** Justification courte, conservée pour le diagnostic interne uniquement. */
  rationale: string
}

export interface PlannerContext {
  allowedMetrics: readonly KpiMetricAlias[]
  allowedDimensions: readonly AnalysisDimension[]
}

export interface PlannerUsage {
  plan: DynamicPlan | null
  usage: AssistantProviderOutput | null
  /** Cause interne d'un repli, jamais publiée telle quelle. */
  reason: 'ok' | 'disabled' | 'invalid' | 'provider_failed' | 'cancelled'
}

const FINANCIAL_METRICS: ReadonlySet<KpiMetricAlias> = new Set<KpiMetricAlias>([
  'purchaseCost', 'deliveryCost', 'confirmationCost', 'contributionMargin',
])

const HINT: Record<AssistantLocale, string> = {
  fr: 'Comprends la demande métier et choisis les opérations utiles.',
  ar: 'افهم طلب العمل واختر العمليات المفيدة.',
  darija: 'Fhem talab dyal l business w khtar l operations li mofidin.',
  en: 'Understand the business question and pick the useful operations.',
}

/**
 * Valide un plan brut. Toute anomalie renvoie `null` : un plan partiellement
 * compris ne doit jamais être exécuté.
 */
export function parseDynamicPlan(raw: unknown, context: PlannerContext): DynamicPlan | null {
  let payload = raw
  if (typeof payload === 'string') {
    const text = payload.trim()
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      payload = JSON.parse(text.slice(start, end + 1))
    } catch {
      return null
    }
  }
  if (!payload || typeof payload !== 'object') return null

  const record = payload as Record<string, unknown>
  // Schéma strict : version obligatoire et aucune propriété inconnue. Un plan
  // qui contient `sql`, `filters` ou `storeIds` n'est pas « partiellement
  // valide » : il est refusé en entier.
  if (record.schema !== PLAN_SCHEMA_VERSION) return null
  const allowedTopLevel = new Set(['schema', 'operations', 'needsSeries', 'rationale'])
  if (Object.keys(record).some((key) => !allowedTopLevel.has(key))) return null
  if (!Array.isArray(record.operations)) return null
  if (record.operations.length === 0 || record.operations.length > MAX_PLANNED_OPERATIONS) return null

  const allowedMetrics = new Set(context.allowedMetrics)
  const allowedDimensions = new Set(context.allowedDimensions)
  const metrics: KpiMetricAlias[] = []
  const dimensions: AnalysisDimension[] = []

  for (const operation of record.operations) {
    if (!operation || typeof operation !== 'object') return null
    const entry = operation as Record<string, unknown>
    const kind = String(entry.kind ?? '')
    const allowedKeys = kind === 'metric'
      ? new Set(['kind', 'metric'])
      : kind === 'dimension'
        ? new Set(['kind', 'dimension'])
        : null
    if (!allowedKeys) return null
    if (Object.keys(entry).some((key) => !allowedKeys.has(key))) return null

    if (kind === 'metric') {
      const metric = String(entry.metric ?? '') as KpiMetricAlias
      if (!metric || !allowedMetrics.has(metric)) return null
      if (!metrics.includes(metric)) metrics.push(metric)
      continue
    }
    if (kind === 'dimension') {
      const dimension = String(entry.dimension ?? '') as AnalysisDimension
      if (!dimension || !allowedDimensions.has(dimension)) return null
      if (!dimensions.includes(dimension)) dimensions.push(dimension)
      continue
    }
    // Type d'opération inconnu : le plan entier est refusé.
    return null
  }

  if (metrics.length === 0 && dimensions.length === 0) return null
  if (metrics.length > MAX_PLANNED_METRICS || dimensions.length > MAX_PLANNED_DIMENSIONS) return null

  return {
    schema: PLAN_SCHEMA_VERSION,
    metrics,
    dimensions,
    needsSeries: record.needsSeries === true,
    rationale: typeof record.rationale === 'string' ? record.rationale.slice(0, 200) : '',
  }
}

/** Prompt strict : vocabulaire fermé, aucune liberté d'invention. */
export function buildPlannerPrompt(input: {
  message: string
  locale: AssistantLocale
  context: PlannerContext
  financialAccess: 'full' | 'commercial'
}): string {
  const metrics = input.context.allowedMetrics
    .filter((metric) => input.financialAccess === 'full' || !FINANCIAL_METRICS.has(metric))
    .join(', ')
  const dimensions = input.context.allowedDimensions.join(', ')
  return [
    'Tu es un planificateur analytique. Tu choisis des OPÉRATIONS dans un vocabulaire fermé.',
    HINT[input.locale] ?? HINT.fr,
    `Métriques autorisées : ${metrics}.`,
    `Dimensions autorisées : ${dimensions}.`,
    `Question : ${input.message.slice(0, 800)}`,
    'Contraintes absolues :',
    '- réponses uniquement dans le vocabulaire fourni, aucune autre valeur ;',
    '- aucune table, aucun SQL, aucun calcul, aucun budget, aucune source inventée ;',
    `- au plus ${MAX_PLANNED_OPERATIONS} opérations, ${MAX_PLANNED_DIMENSIONS} dimensions ;`,
    '- si la question ne nécessite aucun détail, ne mets aucune dimension.',
    'Réponds uniquement en JSON valide :',
    '{"schema":1,"operations":[{"kind":"metric","metric":"<id>"}],"needsSeries":false,"rationale":"..."}',
  ].join('\n')
}

/** Dimensions supplémentaires maximales demandées lors de l'approfondissement. */
export const MAX_DEEPENING_DIMENSIONS = 2

/**
 * Seconde passe réellement guidée par les résultats.
 *
 * Le modèle reçoit les faits déjà calculés et les opérations déjà exécutées ; il
 * peut demander **au plus deux** ventilations supplémentaires, validées et
 * bornées par le backend. Aucune boucle : un seul appel, aucune récursion.
 */
export async function requestDeepeningPlan(input: {
  message: string
  locale: AssistantLocale
  facts: readonly string[]
  executedDimensions: readonly AnalysisDimension[]
  context: PlannerContext
  model: string
  signal?: AbortSignal
  provider?: {
    chat: (request: {
      model: string
      systemPrompt: string
      messages: Array<{ role: 'user' | 'assistant'; content: string }>
      signal?: AbortSignal
      maxOutputTokens?: number
    }) => Promise<AssistantProviderOutput>
  }
}): Promise<PlannerUsage> {
  if (input.signal?.aborted) throw new Error('ASSISTANT_ABORTED')
  if (input.facts.length === 0) return { plan: null, usage: null, reason: 'disabled' }

  const remaining = input.context.allowedDimensions.filter(
    (dimension) => !input.executedDimensions.includes(dimension),
  )
  if (remaining.length === 0) return { plan: null, usage: null, reason: 'disabled' }

  const systemPrompt = [
    'Tu analyses des résultats déjà calculés. Tu ne peux que demander des ventilations supplémentaires.',
    'Interdiction absolue : aucun nombre, aucun SQL, aucune table, aucun budget, aucune métrique.',
    `Dimensions encore disponibles : ${remaining.join(', ')}.`,
    `Maximum ${MAX_DEEPENING_DIMENSIONS} dimensions, uniquement si elles éclairent la question.`,
    'Si les résultats suffisent, renvoie une liste vide.',
    'Réponds uniquement en JSON valide :',
    '{"schema":1,"operations":[{"kind":"dimension","dimension":"<id>"}],"needsSeries":false,"rationale":"..."}',
  ].join('\n')

  const userPrompt = [
    `Question : ${input.message.slice(0, 400)}`,
    'Faits vérifiés :',
    ...input.facts.slice(0, 16).map((fact) => `- ${fact}`),
  ].join('\n')

  try {
    const provider = input.provider ??
      (await import('@/lib/assistant/providers')).getAssistantProvider()
    const result = await provider.chat({
      model: input.model,
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      signal: input.signal,
      maxOutputTokens: 200,
    })
    if (input.signal?.aborted) throw new Error('ASSISTANT_ABORTED')

    // Une liste vide est une réponse valide : aucun approfondissement demandé.
    const parsed = parseDynamicPlan(result.text, { allowedMetrics: [], allowedDimensions: remaining })
    if (parsed && parsed.metrics.length === 0 && parsed.dimensions.length === 0) {
      return { plan: null, usage: result, reason: 'ok' }
    }
    return {
      plan: parsed,
      usage: result,
      reason: parsed ? 'ok' : 'invalid',
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (input.signal?.aborted || code.includes('_ABORTED') || code === 'ASSISTANT_ABORTED') {
      throw new Error('ASSISTANT_ABORTED')
    }
    return { plan: null, usage: null, reason: 'provider_failed' }
  }
}
/**
 * Demande un plan initial au fournisseur.
 *
 * Toute erreur fournisseur ou réponse invalide produit `plan: null` et laisse
 * la main au plan déterministe. Une annulation est propagée, jamais convertie
 * en réponse.
 */
export async function requestDynamicPlan(input: {
  message: string
  locale: AssistantLocale
  context: PlannerContext
  financialAccess: 'full' | 'commercial'
  model: string
  signal?: AbortSignal
  /** Injection de test : évite tout appel réseau. */
  provider?: {
    chat: (request: {
      model: string
      systemPrompt: string
      messages: Array<{ role: 'user' | 'assistant'; content: string }>
      signal?: AbortSignal
      maxOutputTokens?: number
    }) => Promise<AssistantProviderOutput>
  }
}): Promise<PlannerUsage> {
  if (input.signal?.aborted) throw new Error('ASSISTANT_ABORTED')

  try {
    const provider = input.provider ?? (await import('@/lib/assistant/providers')).getAssistantProvider()
    const result = await provider.chat({
      model: input.model,
      systemPrompt: buildPlannerPrompt({
        message: input.message,
        locale: input.locale,
        context: input.context,
        financialAccess: input.financialAccess,
      }),
      messages: [{ role: 'user', content: input.message.slice(0, 800) }],
      signal: input.signal,
      maxOutputTokens: 320,
    })
    if (input.signal?.aborted) throw new Error('ASSISTANT_ABORTED')

    const plan = parseDynamicPlan(result.text, input.context)
    return { plan, usage: result, reason: plan ? 'ok' : 'invalid' }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (input.signal?.aborted || code.includes('_ABORTED') || code === 'ASSISTANT_ABORTED') {
      throw new Error('ASSISTANT_ABORTED')
    }
    return { plan: null, usage: null, reason: 'provider_failed' }
  }
}