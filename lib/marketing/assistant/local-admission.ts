import 'server-only'

/**
 * Admission locale de developpement uniquement.
 *
 * Utilisee quand la base ne peut pas appliquer l'admission distribuee
 * (environnement local non migre). Jamais active en Production : la bascule
 * est refusee si NODE_ENV === 'production'.
 */
type Slot = { hits: number[]; inFlight: boolean }
const slots = new Map<string, Slot>()
const MAX_TRACKED = 500

export function localAdmissionAvailable(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV !== 'production'
}

export function localAdmit(key: string, maxPerMinute = 12, now = Date.now()) {
  if (!localAdmissionAvailable()) return { ok: false as const, code: 'disabled' }
  const slot = slots.get(key) ?? { hits: [] as number[], inFlight: false }
  slot.hits = slot.hits.filter((at) => now - at < 60_000)
  if (slot.inFlight) { slots.set(key, slot); return { ok: false as const, code: 'concurrent' } }
  if (slot.hits.length >= maxPerMinute) { slots.set(key, slot); return { ok: false as const, code: 'rate' } }
  slot.hits.push(now)
  slot.inFlight = true
  slots.set(key, slot)
  if (slots.size > MAX_TRACKED) {
    for (const [id, state] of slots) {
      if (!state.inFlight && state.hits.every((at) => now - at >= 60_000)) slots.delete(id)
    }
  }
  return { ok: true as const }
}

export function localRelease(key: string) {
  const slot = slots.get(key)
  if (slot) slot.inFlight = false
}

/**
 * Comptabilisation locale (développement uniquement, mémoire du processus).
 * Le coût est conservé pour plafonner la journée sans écrire dans Supabase.
 */
let localSpentMicro = 0
let localSpentDay = new Date().toISOString().slice(0, 10)

function rollLocalDay(now = new Date()) {
  const day = now.toISOString().slice(0, 10)
  if (day !== localSpentDay) {
    localSpentDay = day
    localSpentMicro = 0
  }
}

export function localBudgetRemainingMicro(limitMicro: number, now = new Date()) {
  if (!localAdmissionAvailable()) return 0
  rollLocalDay(now)
  return Math.max(0, Math.round(limitMicro) - localSpentMicro)
}

export function localRecordUsage(costMicro: number, inputTokens: number, outputTokens: number, now = new Date()) {
  if (!localAdmissionAvailable()) return
  rollLocalDay(now)
  const cost = Math.max(0, Math.round(costMicro))
  localSpentMicro += cost
  console.info('[public-assistant] local_usage', {
    day: localSpentDay,
    requestCostMicro: cost,
    inputTokens,
    outputTokens,
    daySpentMicro: localSpentMicro,
  })
}

export function localUsageSnapshot() {
  return { day: localSpentDay, spentMicro: localSpentMicro }
}
