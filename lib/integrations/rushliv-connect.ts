import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ensureDefaultPricingGroup,
  getDecryptedIntegrationToken,
  listUserStores,
} from '@/lib/integrations/rapid-delivery-connect'
import type { RushlivCity } from '@/lib/integrations/rushliv'

type AdminClient = SupabaseClient<any, 'public', any>

// Les helpers génériques (token chiffré, stores) sont strictement identiques à
// ceux des autres transporteurs : on les réutilise pour éviter toute divergence.
export { ensureDefaultPricingGroup, getDecryptedIntegrationToken, listUserStores }

export async function getRushlivProviderId(client: AdminClient) {
  const { data, error } = await client
    .from('integration_providers')
    .select('id, slug')
    .eq('slug', 'rushliv')
    .maybeSingle()

  if (error) throw error
  if (!data?.id) throw new Error('RUSHLIV_PROVIDER_NOT_FOUND')
  return data.id as string
}

/**
 * Synchronise le catalogue de villes Rushliv.
 *
 * L'API Rushliv n'expose AUCUN tarif : les villes sont donc stockées avec un
 * prix à 0 (valeur inconnue, pas « gratuit »). Les tarifs sont bloqués côté
 * résolution de frais tant qu'aucune grille officielle n'est fournie, et un
 * éventuel tarif saisi manuellement n'est jamais écrasé par la synchro.
 */
export async function syncRushlivCities(params: {
  client: AdminClient
  providerId: string
  integrationId: string
  userId: string
  cities: RushlivCity[]
}) {
  const { client, providerId, integrationId, userId, cities } = params
  const defaultGroupId = await ensureDefaultPricingGroup(client, providerId)

  const { data: existingRates, error: existingRatesError } = await client
    .from('delivery_rates')
    .select('external_city_key')
    .eq('pricing_group_id', defaultGroupId)

  if (existingRatesError) throw existingRatesError

  const existingKeys = new Set((existingRates || []).map((row) => String(row.external_city_key)))
  const now = new Date().toISOString()

  const missingCities = cities.filter((city) => !existingKeys.has(String(city.id)))
  if (missingCities.length > 0) {
    const { error: insertError } = await client.from('delivery_rates').insert(
      missingCities.map((city) => ({
        pricing_group_id: defaultGroupId,
        provider_id: providerId,
        external_city_key: String(city.id),
        city_name: city.name,
        price: 0,
        cost_refuse: 0,
        cost_cancel: 0,
        updated_at: now,
      }))
    )

    if (insertError) throw insertError
  }

  return { pricingGroupId: defaultGroupId, isCustom: false, created: missingCities.length }
}

export async function syncRushlivConfigs(params: {
  client: AdminClient
  integrationId: string
  userId: string
  storeId: string
  encryptedToken: string
}) {
  const { client, integrationId, userId, storeId, encryptedToken } = params
  const now = new Date().toISOString()

  const { error } = await client.from('rushliv_configs').upsert(
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
