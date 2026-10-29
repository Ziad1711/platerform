/**
 * Helpers d'interface du chatbot : ordre déterministe des messages, décision de
 * défilement et condensation des avertissements analytiques.
 *
 * Module pur (aucune dépendance réseau, base ou facturation) afin d'être testé
 * hors navigateur. Aucun calcul financier n'est effectué ici : les montants et
 * les réserves proviennent tels quels de la réponse structurée.
 */

export type ChatUiRole = 'user' | 'assistant' | 'system'

export interface ChatUiMessage {
  id: string
  thread_id: string
  role: ChatUiRole
  content: string
  credits_used: number
  created_at: string
}

/** Rang de rôle : à horodatage identique, la question précède la réponse. */
const ROLE_RANK: Record<ChatUiRole, number> = { system: 0, user: 1, assistant: 2 }

function timestampOf(message: { created_at: string }): number {
  const parsed = Date.parse(String(message.created_at || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Comparateur chronologique stable.
 *
 * Les messages d'un même échange sont écrits dans la même transaction : ils
 * partagent le même `created_at`. L'ordre par identifiant aléatoire (uuid)
 * produirait alors une inversion aléatoire question/réponse. Le rôle sert donc
 * de départage, puis l'identifiant garantit un ordre total reproductible.
 */
export function compareChatMessages(
  a: { id: string; role: string; created_at: string },
  b: { id: string; role: string; created_at: string }
): number {
  const byTime = timestampOf(a) - timestampOf(b)
  if (byTime !== 0) return byTime

  const byRole = (ROLE_RANK[a.role as ChatUiRole] ?? 9) - (ROLE_RANK[b.role as ChatUiRole] ?? 9)
  if (byRole !== 0) return byRole

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function sortChatMessages<T extends { id: string; role: string; created_at: string }>(messages: readonly T[]): T[] {
  return [...messages].sort(compareChatMessages)
}

export const OPTIMISTIC_MESSAGE_ID = 'optimistic-user-message'

/**
 * Fusionne messages persistés et message optimiste local.
 *
 * - dédoublonnage par identifiant (rechargements, réponses tardives) ;
 * - le message optimiste disparaît dès que le message utilisateur correspondant
 *   est persisté (même contenu, même rôle) : aucun doublon visuel ;
 * - tri systématique : aucune position ne change après rafraîchissement.
 */
export function mergeDisplayMessages<T extends ChatUiMessage>(
  persisted: readonly T[],
  optimistic: { content: string; threadId: string; createdAt?: string } | null
): T[] {
  const seen = new Set<string>()
  const unique: T[] = []

  for (const message of persisted) {
    if (seen.has(message.id)) continue
    seen.add(message.id)
    unique.push(message)
  }

  if (optimistic) {
    const alreadyPersisted = unique.some(
      (message) => message.role === 'user' && message.content.trim() === optimistic.content.trim()
    )

    if (!alreadyPersisted) {
      unique.push({
        id: OPTIMISTIC_MESSAGE_ID,
        thread_id: optimistic.threadId,
        role: 'user',
        content: optimistic.content,
        credits_used: 0,
        created_at: optimistic.createdAt || new Date().toISOString(),
      } as T)
    }
  }

  return sortChatMessages(unique)
}

export type ScrollDecision = 'bottom' | 'assistant-start' | 'none'

/**
 * Décision de défilement, sans effet de bord (testable isolément).
 *
 * - ouverture d'une conversation : bas de la conversation ;
 * - nouvelle réponse assistant : début de cette réponse, une seule fois ;
 * - lecture manuelle en cours (utilisateur remonté) : aucun défilement forcé.
 */
export function decideAutoScroll(input: {
  threadChanged: boolean
  latestAssistantId: string | null
  lastHandledAssistantId: string | null
  userScrolledAway: boolean
}): ScrollDecision {
  if (input.threadChanged) return 'bottom'
  if (!input.latestAssistantId) return 'none'
  if (input.latestAssistantId === input.lastHandledAssistantId) return 'none'
  if (input.userScrolledAway) return 'none'
  return 'assistant-start'
}

/** Réserves qui ne doivent jamais être fondues dans un texte générique. */
const CRITICAL_MARKERS = [
  'partiel',
  'partial',
  'manquant',
  'missing',
  'interdit',
  'forbidden',
  'indisponible',
  'unavailable',
  'devise',
  'currency',
  'non verifie',
  'unverified',
]

export function normalizeWarning(text: string): string {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, "'")
    .replace(/[.!;:,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isCriticalWarning(text: string): boolean {
  const normalized = normalizeWarning(text)
  return CRITICAL_MARKERS.some((marker) => normalized.includes(marker))
}

export type WarningCategory =
  | 'forbidden'
  | 'unavailable'
  | 'currency'
  | 'partial'
  | 'missing'
  | 'unverified'
  | 'other'

interface CategoryRule {
  category: WarningCategory
  label: string
  headline: string
  markers: string[]
}

/**
 * Catégories ordonnées par gravité : la première correspondance pilote le
 * résumé visible. Les libellés sont utilisateur, jamais techniques.
 */
const CATEGORY_RULES: CategoryRule[] = [
  {
    category: 'forbidden',
    label: 'Accès restreint',
    headline: 'Une partie des données n’est pas accessible avec vos droits.',
    markers: ['interdit', 'forbidden', 'non autorise', 'refus'],
  },
  {
    category: 'unavailable',
    label: 'Source indisponible',
    headline: 'Certaines sources n’ont pas répondu sur cette période.',
    markers: ['indisponible', 'unavailable', 'echec', 'erreur'],
  },
  {
    category: 'currency',
    label: 'Devises différentes',
    headline: 'Les périodes ne sont pas comparables : devises différentes.',
    markers: ['devise', 'currency'],
  },
  {
    category: 'partial',
    label: 'Données partielles',
    headline: 'Certaines données sont incomplètes.',
    markers: ['partiel', 'partial', 'couverture'],
  },
  {
    category: 'missing',
    label: 'Données manquantes',
    headline: 'Certaines données sont incomplètes.',
    markers: ['manquant', 'missing', 'absent'],
  },
  {
    category: 'unverified',
    label: 'Valeurs non vérifiées',
    headline: 'Certaines valeurs ne sont pas vérifiées et ne sont pas affichées.',
    markers: ['non verifie', 'unverified', 'non fiable'],
  },
]

export function classifyWarning(text: string): WarningCategory {
  const normalized = normalizeWarning(text)
  for (const rule of CATEGORY_RULES) {
    if (rule.markers.some((marker) => normalized.includes(marker))) return rule.category
  }
  return 'other'
}

export function warningCategoryLabel(category: WarningCategory): string {
  return CATEGORY_RULES.find((rule) => rule.category === category)?.label || 'Précision'
}

/** Jargon interne qui ne doit jamais apparaître dans l'interface. */
const TECHNICAL_FRAGMENTS = [
  /rpc/gi,
  /scan de secours/gi,
  /precision de transport/gi,
  /précision de transport/gi,
  /expression numerique non verifiable/gi,
  /expression numérique non vérifiable/gi,
  /json/gi,
  /null/gi,
  /sql/gi,
]

/**
 * Nettoie un avertissement : retire le jargon interne, les identifiants et les
 * montants (jamais réaffichés dans les avertissements), puis normalise.
 */
export function humanizeWarning(text: string): string {
  let cleaned = String(text || '')
  for (const fragment of TECHNICAL_FRAGMENTS) cleaned = cleaned.replace(fragment, ' ')
  cleaned = cleaned
    .replace(/\b\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d+)?\s*(?:mad|eur|usd|dh)?/gi, ' ')
    .replace(/\d+(?:[.,]\d+)*\s*(?:mad|eur|usd|dh|%)?/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/([.,;:])\s*$/g, '')
    .trim()

  if (!cleaned) cleaned = 'Précision de données'
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

export interface WarningSummary {
  /** Ligne compacte affichée dans la bulle (null si aucun avertissement). */
  summary: string | null
  /** Avertissements distincts restants, dans une section dépliable. */
  details: string[]
  /** Nombre de doublons visuels supprimés. */
  duplicatesRemoved: number
  /** Nombre de réserves critiques parmi les avertissements distincts. */
  criticalCount: number
}

/**
 * Condense les avertissements pour l'interface.
 *
 * - doublons exacts et équivalents (casse, accents, ponctuation, espaces)
 *   fusionnés, puis regroupés par catégorie de gravité ;
 * - le résumé est une phrase utilisateur (« Certaines données sont
 *   incomplètes. »), jamais un message interne ;
 * - les détails sont humanisés (jargon retiré, montants masqués) et conservent
 *   toutes les catégories distinctes : partial, missing, forbidden,
 *   unavailable, devises mixtes, valeurs non vérifiées ;
 * - « marge contributive » et « bénéfice net » restent deux entrées séparées.
 */
export function summarizeWarnings(warnings: readonly string[] | null | undefined): WarningSummary {
  const seenKeys = new Set<string>()
  const groups = new Map<WarningCategory, string[]>()
  let duplicatesRemoved = 0
  let criticalCount = 0

  for (const raw of warnings || []) {
    const text = String(raw || '').trim()
    if (!text) continue

    const category = classifyWarning(text)
    const friendly = humanizeWarning(text)
    const key = `${category}|${normalizeWarning(friendly)}`

    if (seenKeys.has(key)) {
      duplicatesRemoved += 1
      continue
    }

    seenKeys.add(key)
    if (category !== 'other') criticalCount += 1
    groups.set(category, [...(groups.get(category) || []), friendly])
  }

  if (!seenKeys.size) {
    return { summary: null, details: [], duplicatesRemoved, criticalCount: 0 }
  }

  const orderedCategories = CATEGORY_RULES.map((rule) => rule.category).filter((category) => groups.has(category))
  const primary = orderedCategories[0] || 'other'
  const primaryRule = CATEGORY_RULES.find((rule) => rule.category === primary)

  const summary = primaryRule ? primaryRule.headline : 'Précisions sur les données disponibles.'

  const details: string[] = []
  for (const category of orderedCategories) {
    const label = warningCategoryLabel(category)
    for (const item of groups.get(category) || []) {
      details.push(`${label} · ${item}`)
    }
  }

  return { summary, details, duplicatesRemoved, criticalCount }
}

export interface MetricChip {
  label: string
  value: string
}

/**
 * Indicateurs clés issus **exclusivement** de `metrics_summary` (valeurs
 * vérifiées par les outils analytiques) : aucun montant n'est calculé ni
 * déduit ici, seules les entrées vides ou non typées sont écartées.
 */
export function sanitizeMetricsSummary(
  metrics?: Array<{ label?: unknown; value?: unknown }> | null
): MetricChip[] {
  const chips: MetricChip[] = []

  for (const entry of metrics || []) {
    const label = typeof entry?.label === 'string' ? entry.label.trim() : ''
    const raw = entry?.value
    const value =
      typeof raw === 'number' && Number.isFinite(raw)
        ? String(raw)
        : typeof raw === 'string'
          ? raw.trim()
          : ''

    if (!label || !value) continue
    chips.push({ label, value })
    if (chips.length >= 6) break
  }

  return chips
}

/**
 * Un graphique n'est retenu que si les données structurées sont exploitables :
 * au moins deux points et deux dimensions par point. Aucune série n'est
 * fabriquée à partir du texte généré.
 */
export function hasUsableChart(
  response?: { chart?: boolean; chart_data?: Array<Record<string, unknown>> } | null
): boolean {
  if (!response?.chart) return false
  const data = response.chart_data
  if (!Array.isArray(data) || data.length < 2) return false
  return data.every((row) => Boolean(row) && typeof row === 'object' && Object.keys(row).length >= 2)
}

/**
 * Condense les avertissements pour l'interface (implémentation unique : voir
 * plus haut) — bloc conservé volontairement vide pour éviter toute duplication.
 */

