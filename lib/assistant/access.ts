/**
 * Verrou serveur global et allowlist du pilote privé de l'assistant IA.
 *
 * Règles non négociables :
 * - le chatbot est FERMÉ par défaut : seule la valeur exacte `enabled` de
 *   `ASSISTANT_ENABLED` l'ouvre (ni `true`, ni `1`, ni `on`) ;
 * - l'allowlist ne contient que des UUID exacts, fournis par configuration
 *   serveur ; aucune valeur par défaut, aucun email, aucun joker ;
 * - l'identité est toujours celle vérifiée par Supabase Auth côté serveur,
 *   jamais un champ envoyé par le client ;
 * - configuration incomplète = chatbot fermé (fail-closed).
 *
 * Le module est volontairement sans dépendance : il est appelé en tête de
 * chaque route API assistant et peut être testé sans base ni réseau.
 */

export const ASSISTANT_ENABLED_ENV = 'ASSISTANT_ENABLED'
export const ASSISTANT_ALLOWED_USERS_ENV = 'ASSISTANT_ALLOWED_USER_IDS'

/** Drapeaux obligatoires du pilote : idempotence persistante + finalisation atomique. */
export const ASSISTANT_PILOT_REQUIRED_FLAGS = [
  'ASSISTANT_IDEMPOTENCY_REGISTRY',
  'ASSISTANT_FINALIZE_ATOMIC',
] as const

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type EnvLike = Record<string, string | undefined>

function rawFlag(name: string, env: EnvLike): string {
  return String(env[name] ?? '').trim().toLowerCase()
}

/** Verrou global : seul `enabled` ouvre l'assistant. */
export function isAssistantEnabled(env: EnvLike = process.env): boolean {
  return rawFlag(ASSISTANT_ENABLED_ENV, env) === 'enabled'
}

/** Drapeau d'exécution activé explicitement (`enabled` uniquement). */
export function isAssistantFlagEnabled(name: string, env: EnvLike = process.env): boolean {
  return rawFlag(name, env) === 'enabled'
}

/**
 * Liste d'UUID autorisés. Les entrées non-UUID (email, nom, joker) sont
 * ignorées : elles ne peuvent jamais élargir l'accès.
 */
export function parseAssistantAllowedUserIds(raw: string | undefined | null): {
  ids: string[]
  invalid: number
} {
  const values = String(raw ?? '')
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter(Boolean)

  const ids: string[] = []
  let invalid = 0

  for (const value of values) {
    if (!UUID_PATTERN.test(value)) {
      invalid += 1
      continue
    }
    const normalized = value.toLowerCase()
    if (!ids.includes(normalized)) ids.push(normalized)
  }

  return { ids, invalid }
}

export function getAllowedAssistantUserIds(env: EnvLike = process.env): string[] {
  return parseAssistantAllowedUserIds(env[ASSISTANT_ALLOWED_USERS_ENV]).ids
}

/** Identité autorisée : UUID exact, comparaison insensible à la casse. */
export function isAssistantUserAllowed(userId: string | null | undefined, env: EnvLike = process.env): boolean {
  const normalized = String(userId ?? '').trim().toLowerCase()
  if (!UUID_PATTERN.test(normalized)) return false
  return getAllowedAssistantUserIds(env).includes(normalized)
}

/**
 * Mode pilote effectif : verrou ouvert ET allowlist exploitable. Sert de
 * référence aux garde-fous financiers (aucun chemin séquentiel toléré).
 */
export function isAssistantPilotEnforced(env: EnvLike = process.env): boolean {
  return isAssistantEnabled(env) && getAllowedAssistantUserIds(env).length > 0
}

/** Motifs de fermeture (aucun secret, aucun UUID exposé). */
export function getAssistantPilotBlockers(env: EnvLike = process.env): string[] {
  const blockers: string[] = []

  if (!isAssistantEnabled(env)) blockers.push('ASSISTANT_DISABLED')
  if (getAllowedAssistantUserIds(env).length === 0) blockers.push('ASSISTANT_ALLOWLIST_EMPTY')

  for (const flag of ASSISTANT_PILOT_REQUIRED_FLAGS) {
    if (!isAssistantFlagEnabled(flag, env)) blockers.push(`FLAG_DISABLED:${flag}`)
  }

  return blockers
}

export function isAssistantPilotReady(env: EnvLike = process.env): boolean {
  return getAssistantPilotBlockers(env).length === 0
}

/** Refus global, avant toute lecture de données et avant tout appel IA. */
export function assertAssistantEnabled(env: EnvLike = process.env): void {
  if (!isAssistantEnabled(env)) throw new Error('ASSISTANT_DISABLED')
}

/** Refus d'un compte non listé (ou anonyme : identifiant absent). */
export function assertAssistantUserAllowed(userId: string | null | undefined, env: EnvLike = process.env): void {
  assertAssistantEnabled(env)
  if (!isAssistantUserAllowed(userId, env)) throw new Error('ASSISTANT_NOT_ALLOWED')
}

/** Configuration du pilote incomplète : le chatbot reste fermé. */
export function assertAssistantPilotConfig(env: EnvLike = process.env): void {
  if (isAssistantPilotReady(env)) return
  throw new Error('ASSISTANT_PILOT_CONFIG_INCOMPLETE')
}

/** Point d'entrée unique des routes assistant. */
export function assertAssistantAccess(userId: string | null | undefined, env: EnvLike = process.env): void {
  assertAssistantUserAllowed(userId, env)
  assertAssistantPilotConfig(env)
}

/**
 * Garde-fou du chemin financier : en mode pilote, la finalisation séquentielle
 * (non atomique) est interdite. Aucun repli ne doit pouvoir facturer hors de la
 * transaction unique.
 */
export function assertAtomicFinalizationRequired(
  atomicEnabled: boolean,
  env: EnvLike = process.env
): void {
  if (atomicEnabled) return
  if (isAssistantPilotEnforced(env)) throw new Error('ASSISTANT_PILOT_CONFIG_INCOMPLETE')
}
