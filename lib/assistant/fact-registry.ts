/**
 * Registre des faits vérifiés d'un tour de l'assistant.
 *
 * Objectif : le texte rédigé par le modèle ne peut citer un nombre que s'il
 * provient réellement d'un résultat d'outil validé. Auparavant, tout nombre du
 * texte était retiré (même un chiffre pourtant publié par les outils), ce qui
 * produisait des réserves « chiffre non vérifié » injustifiées.
 *
 * Règles :
 * - seules les clés numériques métier sont collectées (liste blanche) : un
 *   identifiant, une date, une version ou un état ne deviennent jamais un fait ;
 * - une métrique `missing`, `forbidden` ou `unavailable` n'alimente jamais le
 *   registre ;
 * - les valeurs restent des textes décimaux exacts, jamais des `number`
 *   recalculés.
 */
import type { AnalyticsState } from '@/lib/assistant/analytics-contract'

/** États qui interdisent toute publication de valeur. */
const BLOCKED_STATES: ReadonlySet<string> = new Set(['missing', 'forbidden', 'unavailable'])

/** Clés numériques porteuses d'un fait métier. */
const FACT_KEYS: ReadonlySet<string> = new Set([
  'value',
  'count',
  'revenue',
  'ads',
  'profit',
  'quantity',
  'current',
  'baseline',
  'delta',
  'numerator',
  'denominator',
  'totalOrders',
  'confirmedOrders',
  'deliveredOrders',
  'returnedOrders',
  'cancelledOrders',
  'sentOrders',
  'waitingPickupOrders',
  'pendingOrders',
  'rankedRevenue',
  'rankedProducts',
  'sampleSize',
])

const MAX_COLLECTED_VALUES = 400

function isBlockedMetric(value: Record<string, unknown>): boolean {
  const state = typeof value.state === 'string' ? value.state : null
  return state !== null && BLOCKED_STATES.has(state)
}

function pushValue(target: Set<string>, raw: unknown) {
  if (target.size >= MAX_COLLECTED_VALUES) return
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return
    target.add(String(raw))
    return
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    target.add(raw.trim())
  }
}

function walk(node: unknown, target: Set<string>, depth: number) {
  if (depth > 8 || target.size >= MAX_COLLECTED_VALUES) return

  if (Array.isArray(node)) {
    for (const item of node) walk(item, target, depth + 1)
    return
  }

  if (!node || typeof node !== 'object') return
  const record = node as Record<string, unknown>

  // Une métrique du contrat porte son état : un état bloqué ne publie rien.
  if ('unit' in record && 'state' in record && isBlockedMetric(record)) return

  for (const [key, value] of Object.entries(record)) {
    if (key === 'state' || key === 'unit' || key === 'definition') continue

    if (FACT_KEYS.has(key)) {
      if (value === null || value === undefined) continue
      if (typeof value === 'object') continue
      pushValue(target, value)
      continue
    }

    if (value && typeof value === 'object') walk(value, target, depth + 1)
  }
}

/**
 * Valeurs numériques vérifiées d'un tour, sous forme de textes exacts.
 * Aucune valeur bloquée, aucune clé hors métier.
 */
export function collectVerifiedValues(toolData: Record<string, unknown>): string[] {
  const collected = new Set<string>()
  walk(toolData, collected, 0)
  return Array.from(collected)
}

/**
 * Déduplication des réserves : casse, accents, ponctuation et espaces ne
 * doivent pas produire deux avertissements visuellement identiques.
 */
export function dedupeMessages(messages: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const message of messages) {
    const text = String(message ?? '').trim()
    if (!text) continue

    const key = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, "'")
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()

    if (seen.has(key)) continue
    seen.add(key)
    result.push(text)
  }

  return result
}

/** État global d'une métrique, tolérant aux objets partiels. */
export function metricState(value: unknown): AnalyticsState | null {
  if (!value || typeof value !== 'object') return null
  const state = (value as { state?: unknown }).state
  return typeof state === 'string' ? (state as AnalyticsState) : null
}
