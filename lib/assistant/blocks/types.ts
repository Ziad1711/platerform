/**
 * Document de réponse versionné.
 *
 * Le serveur ne renvoie plus un texte Markdown que le client doit réinterpréter :
 * il renvoie des **blocs typés**, chacun porteur d'une valeur déjà vérifiée.
 *
 * Avantages :
 * - aucune duplication entre texte, badges, tableaux et graphiques : un fait
 *   n'apparaît que dans le bloc qui le représente le mieux ;
 * - rendu localisé et directionnel contrôlé côté client, sans heuristique ;
 * - compatibilité assurée par `version`, les anciens messages restant lisibles.
 */
import type { TextDirection, TextScript, AssistantLocale } from '@/lib/assistant/semantic/locale'
import type { PeriodPlan } from '@/lib/assistant/semantic/periods'
import type { AnalysisEvidence, EvidenceClaim } from '@/lib/assistant/fact-registry'

export const RESPONSE_DOCUMENT_VERSION = 1

export type BlockNoticeSeverity = 'info' | 'warning'

export interface KpiItem {
  evidenceIds?: string[]
  /** Identifiant du fait (métrique ou dérivée), jamais un libellé. */
  id: string
  label: string
  /** Valeur déjà formatée côté serveur (décimal exact + unité). */
  value: string
  /** `partial` = valeur publiable avec réserve. */
  state: 'value' | 'partial'
}

export interface TableColumn {
  key: string
  label: string
  /** Direction de la colonne : les valeurs numériques restent LTR. */
  direction: TextDirection
  align: 'start' | 'end'
}

export interface TableCell {
  evidenceIds?: string[]
  value: string
  direction: TextDirection
}

export interface TableBlock {
  title?: string
  columns: TableColumn[]
  rows: Array<{ key: string; cells: TableCell[] }>
  /** Phrase discrète rappelant la réserve principale. */
  caption?: string
}

export interface ChartSeries {
  key: string
  label: string
  color?: string
}

export interface ChartPoint {
  evidenceIds?: string[]
  x: string
  values: Record<string, number | null>
}

export interface ChartBlock {
  kind: 'line' | 'bar'
  title: string
  unit: 'currency' | 'count' | 'percent'
  series: ChartSeries[]
  points: ChartPoint[]
}

export type ResponseBlock = (
  | { type: 'summary'; text: string }
  | { type: 'kpi'; title?: string; items: KpiItem[] }
  | { type: 'table'; table: TableBlock }
  | { type: 'chart'; chart: ChartBlock }
  | { type: 'insights'; title: string; items: string[] }
  | { type: 'recommendations'; title: string; items: string[] }
  | { type: 'notice'; severity: BlockNoticeSeverity; text: string; details?: string[] }
  | { type: 'clarification'; question: string }
  | { type: 'analysis'; title: string; claims: EvidenceClaim[] }
) & { evidenceIds?: string[] }

/** Choix de présentation retenu par le serveur pour cette demande. */
export type PresentationMode = 'short' | 'table' | 'chart' | 'mixed'

export interface ResponseDocument {
  version: number
  locale: AssistantLocale
  script: TextScript
  direction: TextDirection
  presentation: PresentationMode
  blocks: ResponseBlock[]
  evidence?: AnalysisEvidence[]
  analysis?: {
    schema: 1
    periodPlan: PeriodPlan
    requestedMetrics: string[]
    requestedDimensions: string[]
    windows: Array<{ id: string; state: string; publishedMetrics: string[] }>
    /**
     * Réponse explicative produite par l'agent : le résumé et les affirmations
     * étiquetées (hypothèse/recommandation) ont été validés sans chiffre.
     */
    agent?: boolean
  }
}

export function isResponseDocument(value: unknown): value is ResponseDocument {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<ResponseDocument>
  return typeof record.version === 'number' && Array.isArray(record.blocks)
}

/** Un document vide reste valide : aucune section n'est inventée. */
export function emptyDocument(
  locale: AssistantLocale,
  script: TextScript,
  direction: TextDirection,
): ResponseDocument {
  return {
    version: RESPONSE_DOCUMENT_VERSION,
    locale,
    script,
    direction,
    presentation: 'short',
    blocks: [],
  }
}
