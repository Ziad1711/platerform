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
 * Condense les avertissements : doublons exacts et équivalents (casse, accents,
 * ponctuation, espaces) fusionnés ; une réserve critique reste toujours
 * présentée distinctement et n'est jamais absorbée par un texte générique
 * (« marge contributive » et « bénéfice net » restent deux entrées séparées).
 */
export function summarizeWarnings(warnings: readonly string[] | null | undefined): WarningSummary {
  const unique: Array<{ text: string; key: string; critical: boolean }> = []
  let duplicatesRemoved = 0

  for (const raw of warnings || []) {
    const text = String(raw || '').trim()
    if (!text) continue

    const key = normalizeWarning(text)
    const critical = isCriticalWarning(text)

    // Deux réserves critiques ne sont fusionnées que si leurs textes normalisés
    // sont strictement identiques ; un doublon non critique suit la même règle.
    if (unique.some((entry) => entry.key === key)) {
      duplicatesRemoved += 1
      continue
    }

    unique.push({ text, key, critical })
  }

  if (!unique.length) {
    return { summary: null, details: [], duplicatesRemoved, criticalCount: 0 }
  }

  const criticalCount = unique.filter((entry) => entry.critical).length
  const [first, ...rest] = unique

  const summary =
    rest.length === 0
      ? first.text
      : `${first.text} (+${rest.length} autre${rest.length > 1 ? 's' : ''} limite${rest.length > 1 ? 's' : ''})`

  return {
    summary,
    details: rest.map((entry) => entry.text),
    duplicatesRemoved,
    criticalCount,
  }
}
