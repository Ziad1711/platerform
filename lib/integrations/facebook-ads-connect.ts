import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSecret, encryptSecret, isEncryptedSecret } from '@/lib/security/crypto'

type AdminClient = SupabaseClient<any, 'public', any>

export async function getFacebookAdsProviderId(client: AdminClient) {
  const { data, error } = await client
    .from('integration_providers')
    .select('id')
    .eq('slug', 'facebook-ads')
    .maybeSingle()

  if (error) throw error
  if (!data?.id) throw new Error('FACEBOOK_ADS_PROVIDER_NOT_FOUND')
  return String(data.id)
}

export async function getFacebookIntegration(client: AdminClient, userId: string) {
  const { data, error } = await client
    .from('integrations')
    .select('id, access_token, status')
    .eq('user_id', userId)
    .eq('provider', 'facebook-ads')
    .maybeSingle()

  if (error) throw error
  return data
}

export async function getFacebookDecryptedToken(client: AdminClient, integrationId: string) {
  const { data, error } = await client
    .from('integrations')
    .select('access_token')
    .eq('id', integrationId)
    .single()

  if (error) throw error
  const raw = String(data.access_token || '')
  const decrypted = decryptSecret(raw)

  if (!isEncryptedSecret(raw)) {
    await client
      .from('integrations')
      .update({ access_token: encryptSecret(decrypted), updated_at: new Date().toISOString() })
      .eq('id', integrationId)
  }

  return decrypted
}
