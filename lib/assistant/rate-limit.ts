/**
 * Limitation de débit et verrou de concurrence de l'assistant IA.
 *
 * Portée : mémoire du processus. Sur Vercel, chaque instance possède son propre
 * compteur ; il s'agit donc d'une protection anti-abus et anti-double-envoi,
 * pas d'une garantie globale répartie. Une limitation distribuée (Postgres ou
 * service externe) reste une décision hors Lot 1.
 */
export const ASSISTANT_RATE_LIMIT_MAX = 20
export const ASSISTANT_RATE_LIMIT_WINDOW_MS = 60_000
const MAX_TRACKED_USERS = 2_000

interface AssistantSlotState {
  hits: number[]
  inFlight: number
}

const slots = new Map<string, AssistantSlotState>()

export type AssistantSlotResult =
  | { ok: true }
  | { ok: false; code: 'RATE_LIMITED' | 'CONCURRENT_REQUEST' }

function trimTrackedUsers() {
  while (slots.size > MAX_TRACKED_USERS) {
    const oldest = slots.keys().next()
    if (oldest.done) return
    slots.delete(oldest.value)
  }
}

function getState(key: string): AssistantSlotState {
  const existing = slots.get(key)
  if (existing) return existing

  const created: AssistantSlotState = { hits: [], inFlight: 0 }
  slots.set(key, created)
  trimTrackedUsers()
  return created
}

/**
 * Réserve un créneau pour une requête : refuse une seconde requête simultanée
 * du même utilisateur (double facturation) et applique la fenêtre glissante.
 */
export function acquireAssistantSlot(key: string, now = Date.now()): AssistantSlotResult {
  const state = getState(key)
  const windowStart = now - ASSISTANT_RATE_LIMIT_WINDOW_MS
  state.hits = state.hits.filter((at) => at > windowStart)

  if (state.inFlight > 0) {
    return { ok: false, code: 'CONCURRENT_REQUEST' }
  }

  if (state.hits.length >= ASSISTANT_RATE_LIMIT_MAX) {
    return { ok: false, code: 'RATE_LIMITED' }
  }

  state.hits.push(now)
  state.inFlight += 1
  return { ok: true }
}

export function releaseAssistantSlot(key: string) {
  const state = slots.get(key)
  if (!state) return
  state.inFlight = Math.max(0, state.inFlight - 1)
}

/** Réinitialisation locale (vérifications ciblées, aucun effet en production). */
export function resetAssistantSlots() {
  slots.clear()
}