/**
 * Client backend dédié aux écritures fiables de l'assistant (service_role).
 *
 * Pourquoi : `authenticated` ne doit jamais pouvoir écrire un message
 * `assistant`/`system` via PostgREST (falsification d'historique et de mémoire).
 * Les écritures de confiance passent par ce client, côté serveur uniquement.
 *
 * Le client n'est JAMAIS exposé au navigateur, ni transmis au modèle, ni
 * retourné dans une réponse HTTP.
 */
import { createAdminClient } from '@/lib/supabase/admin'

export type AssistantBackendClient = ReturnType<typeof createAdminClient>

/** Politique fail-closed : les écritures fiables sont exigées par défaut. */
export const ASSISTANT_BACKEND_WRITES_ENABLED =
  (process.env.ASSISTANT_BACKEND_WRITES || 'enabled').trim().toLowerCase() !== 'disabled'

let cached: AssistantBackendClient | null = null
let cachedMissing = false

export function getAssistantBackendClient(): AssistantBackendClient | null {
  if (cached) return cached
  if (cachedMissing) return null

  try {
    cached = createAdminClient()
    return cached
  } catch {
    cachedMissing = true
    return null
  }
}

export function requireAssistantBackendClient(): AssistantBackendClient {
  const client = getAssistantBackendClient()
  if (!client) throw new Error('ASSISTANT_BACKEND_UNAVAILABLE')
  return client
}

/** Réinitialisation locale (tests synthétiques uniquement). */
export function resetAssistantBackendClientCache() {
  cached = null
  cachedMissing = false
}
