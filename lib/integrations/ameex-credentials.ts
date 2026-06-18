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
