import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

const API_KEY_PREFIX = 'jsk_'

export const API_SCOPES = ['products:read', 'stock:read', 'orders:write'] as const

export type ApiScope = (typeof API_SCOPES)[number]

export type ApiKeyValidation = {
  valid: boolean
  storeId: string | null
  apiKeyId: string | null
  scopes: ApiScope[]
  reason?: string
}

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = `${API_KEY_PREFIX}${crypto.randomBytes(32).toString('hex')}`
  const prefix = raw.slice(0, 10)
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  return { raw, prefix, hash }
}

export function hashApiKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

export function isValidApiKeyFormat(raw: string): boolean {
  return raw.startsWith(API_KEY_PREFIX) && raw.length > 20
}

/**
 * Normalise les périmètres demandés : seuls les périmètres connus sont conservés.
 * Une valeur vide ou invalide retombe sur un accès complet (comportement historique).
 */
export function normalizeScopes(raw: unknown): ApiScope[] {
  if (!Array.isArray(raw)) return [...API_SCOPES]

  const requested = raw
    .map((scope) => String(scope || '').trim())
    .filter((scope): scope is ApiScope => (API_SCOPES as readonly string[]).includes(scope))

  const unique = Array.from(new Set(requested))
  return unique.length > 0 ? unique : [...API_SCOPES]
}

export function hasScope(scopes: ApiScope[] | null | undefined, scope: ApiScope): boolean {
  return Array.isArray(scopes) && scopes.includes(scope)
}

export async function validateApiKey(rawKey: string): Promise<ApiKeyValidation> {
  if (!isValidApiKeyFormat(rawKey)) {
    return { valid: false, storeId: null, apiKeyId: null, scopes: [], reason: 'INVALID_FORMAT' }
  }

  const hash = hashApiKey(rawKey)
  const supabase = createAdminClient()

  const { data: key, error } = await supabase
    .from('public_api_keys')
    .select('id, store_id, is_active, revoked_at, scopes')
    .eq('key_hash', hash)
    .single()

  if (error || !key) {
    return { valid: false, storeId: null, apiKeyId: null, scopes: [], reason: 'NOT_FOUND' }
  }

  if (!key.is_active || key.revoked_at) {
    return { valid: false, storeId: null, apiKeyId: key.id, scopes: [], reason: 'REVOKED' }
  }

  // Update last_used_at (fire & forget)
  supabase
    .from('public_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', key.id)
    .then()

  return {
    valid: true,
    storeId: key.store_id,
    apiKeyId: key.id,
    scopes: normalizeScopes(key.scopes),
  }
}

