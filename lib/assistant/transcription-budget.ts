/**
 * Plafond de coût et limitation de fréquence de la dictée vocale.
 *
 * Portée : mémoire du processus. Sur Vercel, chaque instance possède son propre
 * compteur : c'est une protection anti-abus et anti-double-envoi, **pas** une
 * garantie globale répartie. Une limitation distribuée exigerait une migration
 * dédiée, volontairement hors de cette version.
 */
import {
  MAX_AUDIO_SECONDS,
  TRANSCRIPTION_DAILY_SECONDS,
  TRANSCRIPTION_MAX_REQUESTS,
  TRANSCRIPTION_WINDOW_MS,
} from '@/lib/assistant/transcription-limits'

const MAX_TRACKED_USERS = 2_000

interface BudgetEntry {
  hits: number[]
  secondsUsed: number
  day: string
}

const entries = new Map<string, BudgetEntry>()

export type TranscriptionBudgetResult =
  | { ok: true }
  | { ok: false; code: 'TRANSCRIPTION_RATE_LIMITED' | 'TRANSCRIPTION_DAILY_LIMIT' }

/* -------------------------------------------------------------------------- */
/* Idempotence locale : une même tentative ne paie pas deux fois              */
/* -------------------------------------------------------------------------- */

const IDEMPOTENCY_TTL_MS = 10 * 60_000
const idempotency = new Map<string, { state: 'pending' | 'done'; text?: string; at: number }>()

function idempotencyKey(userId: string, requestId: string): string {
  return `${userId}:${requestId}`
}

function pruneIdempotency(now: number) {
  for (const [key, entry] of idempotency) {
    if (now - entry.at >= IDEMPOTENCY_TTL_MS) idempotency.delete(key)
  }
}

export type TranscriptionClaim =
  | { status: 'new' }
  | { status: 'pending' }
  | { status: 'done'; text: string }

/**
 * Réserve une tentative avant l'appel fournisseur. Un doublon simultané reçoit
 * `pending` (aucun second appel), un doublon terminé reçoit le texte déjà payé.
 * Portée : mémoire du processus — ce n'est pas une garantie inter-instances.
 */
export function claimTranscriptionRequest(
  userId: string,
  requestId: string,
  now = Date.now(),
): TranscriptionClaim {
  pruneIdempotency(now)
  const key = idempotencyKey(userId, requestId)
  const existing = idempotency.get(key)

  if (existing) {
    if (existing.state === 'done' && typeof existing.text === 'string') {
      return { status: 'done', text: existing.text }
    }
    return { status: 'pending' }
  }

  idempotency.set(key, { state: 'pending', at: now })
  return { status: 'new' }
}

/** Enregistre le texte payé et libère le verrou de tentative. */
export function completeTranscriptionRequest(
  userId: string,
  requestId: string,
  text: string,
  now = Date.now(),
): void {
  idempotency.set(idempotencyKey(userId, requestId), { state: 'done', text, at: now })
}

/** Échec fournisseur : la tentative peut être relancée sans faux résultat. */
export function failTranscriptionRequest(userId: string, requestId: string): void {
  idempotency.delete(idempotencyKey(userId, requestId))
}

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

function prune(now: number) {
  if (entries.size <= MAX_TRACKED_USERS) return
  for (const [key, entry] of entries) {
    if (entries.size <= MAX_TRACKED_USERS) return
    const idle = entry.hits.every((at) => now - at >= TRANSCRIPTION_WINDOW_MS)
    if (idle && entry.secondsUsed === 0) entries.delete(key)
  }
  while (entries.size > MAX_TRACKED_USERS) {
    const oldest = entries.keys().next()
    if (oldest.done) return
    entries.delete(oldest.value)
  }
}

function readEntry(userId: string, now: number): BudgetEntry {
  const day = dayKey(now)
  const existing = entries.get(userId)
  if (existing && existing.day === day) return existing

  const created: BudgetEntry = { hits: [], secondsUsed: 0, day }
  entries.set(userId, created)
  prune(now)
  return created
}

/**
 * Réserve une durée avant l'appel fournisseur : deux requêtes simultanées ne
 * peuvent pas dépasser ensemble le plafond. La réservation est libérée si
 * l'appel échoue sans produire de transcription.
 */
export function reserveTranscriptionBudget(
  userId: string,
  seconds: number,
  now = Date.now(),
): TranscriptionBudgetResult {
  const entry = readEntry(userId, now)
  const windowStart = now - TRANSCRIPTION_WINDOW_MS
  entry.hits = entry.hits.filter((at) => at > windowStart)

  if (entry.hits.length >= TRANSCRIPTION_MAX_REQUESTS) {
    return { ok: false, code: 'TRANSCRIPTION_RATE_LIMITED' }
  }

  const requested = Math.min(Math.max(Math.ceil(seconds), 1), MAX_AUDIO_SECONDS)
  if (entry.secondsUsed + requested > TRANSCRIPTION_DAILY_SECONDS) {
    return { ok: false, code: 'TRANSCRIPTION_DAILY_LIMIT' }
  }

  entry.hits.push(now)
  entry.secondsUsed += requested
  return { ok: true }
}

/** Libère une réservation lorsque l'appel n'a produit aucun texte facturable. */
export function releaseTranscriptionBudget(userId: string, seconds: number, now = Date.now()): void {
  const entry = entries.get(userId)
  if (!entry) return
  const released = Math.min(Math.max(Math.ceil(seconds), 0), MAX_AUDIO_SECONDS)
  entry.secondsUsed = Math.max(0, entry.secondsUsed - released)
  // La tentative reste comptée dans la fenêtre : un échec ne doit pas ouvrir
  // un droit illimité à de nouveaux appels.
  prune(now)
}

/** Réinitialisation locale (vérifications ciblées, aucun effet en production). */
export function resetTranscriptionBudget(): void {
  entries.clear()
  idempotency.clear()
}
