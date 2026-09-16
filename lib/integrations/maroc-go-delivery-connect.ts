import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ensureDefaultPricingGroup,
  getDecryptedIntegrationToken,
  listUserStores,
  resolveDefaultRapidDeliveryShopKey,
  syncDeliveryShops,
  syncDeliveryStates,
  syncPricingGroups,
} from '@/lib/integrations/rapid-delivery-connect'

type AdminClient = SupabaseClient<any, 'public', any>

export type MarocGoDeliveryShopMappingInput = {
  externalShopId: number
  storeId: string | null
}

// Les helpers génériques (pricing groups, shops, states, stores, token) sont
// strictement identiques à ceux de Rapid Delivery : on les réutilise pour
// éviter toute divergence de comportement.
export {
  ensureDefaultPricingGroup,
  getDecryptedIntegrationToken,
  listUserStores,
  syncDeliveryShops,
  syncDeliveryStates,
  syncPricingGroups,
}

export const resolveDefaultMarocGoDeliveryShopKey = resolveDefaultRapidDeliveryShopKey

export async function getMarocGoDeliveryProviderId(client: AdminClient) {
  const { data, error } = await client
    .from('integration_providers')
    .select('id, slug')
    .eq('slug', 'maroc-go-delivery')
    .maybeSingle()

  if (error) throw error
  if (!data?.id) throw new Error('MAROC_GO_DELIVERY_PROVIDER_NOT_FOUND')
  return data.id as string
}

export async function syncMarocGoDeliveryConfigs(params: {
  client: AdminClient
  integrationId: string
  userId: string
  storeId: string
  encryptedToken: string
}) {
  const { client, integrationId, userId, storeId, encryptedToken } = params
  const now = new Date().toISOString()

  const { error } = await client.from('maroc_go_delivery_configs').upsert(
    {
      integration_id: integrationId,
      user_id: userId,
      store_id: storeId,
      api_token: encryptedToken,
      updated_at: now,
    },
    { onConflict: 'integration_id' }
  )

  if (error) throw error
}
