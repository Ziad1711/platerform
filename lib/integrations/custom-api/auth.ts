import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

const API_KEY_PREFIX = 'jsk_'

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

export async function validateApiKey(rawKey: string): Promise<{
  valid: boolean
  storeId: string | null
  apiKeyId: string | null
  reason?: string
}> {
  if (!isValidApiKeyFormat(rawKey)) {
    return { valid: false, storeId: null, apiKeyId: null, reason: 'INVALID_FORMAT' }
  }

  const hash = hashApiKey(rawKey)
  const supabase = createAdminClient()

  const { data: key, error } = await supabase
    .from('public_api_keys')
    .select('id, store_id, is_active, revoked_at')
    .eq('key_hash', hash)
    .single()

  if (error || !key) {
    return { valid: false, storeId: null, apiKeyId: null, reason: 'NOT_FOUND' }
  }

  if (!key.is_active || key.revoked_at) {
    return { valid: false, storeId: null, apiKeyId: key.id, reason: 'REVOKED' }
  }

  // Update last_used_at (fire & forget)
  supabase
    .from('public_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', key.id)
    .then()

  return { valid: true, storeId: key.store_id, apiKeyId: key.id }
}
