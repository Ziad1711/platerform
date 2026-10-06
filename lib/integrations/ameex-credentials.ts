// ============================================================
// Utilitaire de récupération des credentials AMEEX
// Le token stocké est: JSON.stringify({ apiId, apiKey: encryptedKey })
// puis re-chiffré avec encryptSecret()
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSecret, isEncryptedSecret } from '@/lib/security/crypto'

type AdminClient = SupabaseClient<any, 'public', any>

export type AmeexCredentials = {
  apiId: string
  apiKey: string
}

/**
 * Récupère et déchiffre les credentials AMEEX depuis la table integrations.
 * Le token stocké est: encryptSecret(JSON.stringify({ apiId, apiKey: encryptSecret(apiKey) }))
 */
export async function getAmeexCredentials(
  client: AdminClient,
  integrationId: string,
): Promise<AmeexCredentials> {
  const { data, error } = await client
    .from('integrations')
    .select('id, access_token')
    .eq('id', integrationId)
    .single()

  if (error) throw error
  if (!data?.access_token) throw new Error('AMEEX_CREDENTIALS_NOT_FOUND')

  const raw = String(data.access_token)
  const decrypted = decryptSecret(raw)

  // Le token est un JSON: { apiId, apiKey: encryptedKey }
  let parsed: { apiId?: string; apiKey?: string }
  try {
    parsed = JSON.parse(decrypted) as { apiId?: string; apiKey?: string }
  } catch {
    // Fallback: si le token est juste l'apiKey brute (ancien format)
    return { apiId: decrypted, apiKey: decrypted }
  }

  const apiId = String(parsed.apiId || '').trim()
  let apiKey = String(parsed.apiKey || '').trim()

  // Si apiKey est encore chiffré, le déchiffrer
  if (isEncryptedSecret(apiKey)) {
    apiKey = decryptSecret(apiKey)
  }

  if (!apiId || !apiKey) {
    throw new Error('AMEEX_CREDENTIALS_INCOMPLETE')
  }

  return { apiId, apiKey }
}

/**
 * Récupère et déchiffre le secret de signature des webhooks AMEEX d'un store.
 * Retourne `null` si aucun secret n'est configuré (le webhook doit alors
 * refuser l'événement plutôt que de le traiter sans authentification).
 */
export async function getAmeexWebhookSecret(
  client: AdminClient,
  storeId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('ameex_configs')
    .select('webhook_secret_encrypted')
    .eq('store_id', storeId)
    .maybeSingle()

  if (error) throw error

  const raw = String(data?.webhook_secret_encrypted || '').trim()
  if (!raw) return null

  return isEncryptedSecret(raw) ? decryptSecret(raw) : raw
}
