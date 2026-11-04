/**
 * Registre des outils analytiques exposés à l'agent.
 *
 * Seul ce registre définit ce que le modèle peut demander. Il ne contient ni
 * SQL, ni nom de table, ni identifiant de boutique : uniquement des opérations
 * déjà implémentées par les lecteurs validés du produit.
 *
 * Le modèle choisit un outil **par identifiant** ; le backend décide de
 * l'exécution et applique ses propres bornes (fenêtres, dimensions, lignes).
 */
import { z } from 'zod'
import type { AnalysisDimension } from '@/lib/assistant/semantic/request'

export const AGENT_TOOL_IDS = ['read_kpis', 'read_dimension', 'read_series'] as const
export type AgentToolId = (typeof AGENT_TOOL_IDS)[number]

/** Dimensions réellement exposées (alignées sur l'exécuteur). */
export const AGENT_DIMENSIONS: readonly AnalysisDimension[] = [
  'city',
  'product',
  'confirmation',
  'agent',
  'status',
]

export interface AgentToolContract {
  id: AgentToolId
  /** Description transmise au modèle : ce que l'outil renvoie, jamais comment. */
  description: string
  /** Paramètres acceptés, déjà bornés par le backend. */
  args: readonly string[]
}

export const AGENT_TOOLS: readonly AgentToolContract[] = [
  {
    id: 'read_kpis',
    description: 'Totaux et indicateurs d’une fenêtre temporelle validée par le serveur.',
    args: ['windowId', 'metrics'],
  },
  {
    id: 'read_dimension',
    description: 'Ventilation d’une fenêtre par ville, produit, agent, statut ou confirmation.',
    args: ['windowId', 'dimension'],
  },
  {
    id: 'read_series',
    description: 'Série journalière d’une fenêtre, pour une tendance dans le temps.',
    args: ['windowId', 'metric'],
  },
]

/** Schéma d'un appel d'outil proposé par le modèle. */
export const AgentToolCallSchema = z.object({
  tool: z.enum(AGENT_TOOL_IDS),
  windowId: z.string().min(1).max(8).optional(),
  metric: z.string().min(1).max(64).optional(),
  dimension: z.string().min(1).max(32).optional(),
}).strict()

export type AgentToolCall = z.infer<typeof AgentToolCallSchema>

/**
 * Un appel est valide si l'outil existe et si ses paramètres obligatoires sont
 * présents et autorisés. Toute autre forme est refusée, jamais corrigée.
 */
export function isValidToolCall(call: AgentToolCall): boolean {
  if (call.tool === 'read_dimension') {
    return Boolean(call.dimension) && AGENT_DIMENSIONS.includes(call.dimension as AnalysisDimension)
  }
  if (call.tool === 'read_series') return Boolean(call.metric)
  return true
}

/** Description textuelle injectée dans le prompt d'interprétation. */
export function describeToolsForPrompt(): string {
  return AGENT_TOOLS
    .map((tool) => `- ${tool.id}(${tool.args.join(', ')}) : ${tool.description}`)
    .join('\n')
}
