import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSecret } from '@/lib/security/crypto'

type AdminClient = SupabaseClient<any, 'public', any>

export async function getSenditCredentials(client: AdminClient, integrationId: string) {
  const { data, error } = await client
    .from('integrations')
    .select('access_token')
    .eq('id', integrationId)
    .single()
  if (error) throw error
  if (!data?.access_token) throw new Error('SENDIT_CREDENTIALS_NOT_FOUND')
  const parsed = JSON.parse(decryptSecret(String(data.access_token))) as { publicKey?: string; secretKey?: string; token?: string }
  const publicKey = String(parsed.publicKey || '').trim()
  const secretKey = String(parsed.secretKey || '').trim()
  const token = String(parsed.token || '').trim()
  if (!publicKey || !secretKey || !token) throw new Error('SENDIT_CREDENTIALS_INCOMPLETE')
  return { publicKey, secretKey, token }
}