import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSecret, encryptSecret, isEncryptedSecret } from '@/lib/security/crypto'
import type { RapidDeliveryCity, RapidDeliveryShop, RapidDeliveryState } from '@/lib/integrations/rapid-delivery'
import { resolveRapidDeliveryApiBaseUrl } from '@/lib/integrations/rapid-delivery'

type AdminClient = SupabaseClient<any, 'public', any>

export type RapidDeliveryShopMappingInput = {
  externalShopId: number
  storeId: string | null
}

export async function resolveDefaultRapidDeliveryShopKey(params: {
  client: AdminClient
  integrationId: string
  storeId: string
  fallbackShopKey?: number | null
}) {
  const direct = Number(params.fallbackShopKey || 0) || 0
  if (direct) return direct

  const { data, error } = await params.client
    .from('delivery_shops')
    .select('external_shop_id')
    .eq('integration_id', params.integrationId)
    .eq('store_id', params.storeId)
    .order('external_shop_id', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return Number(data?.external_shop_id || 0) || 0
}

export async function getRapidDeliveryProviderId(client: AdminClient) {
  const { data, error } = await client
    .from('integration_providers')
    .select('id, slug')
    .eq('slug', 'rapid-delivery')
    .maybeSingle()

  if (error) throw error
  if (!data?.id) throw new Error('RAPID_DELIVERY_PROVIDER_NOT_FOUND')
  return data.id as string
}

export async function listUserStores(client: AdminClient, userId: string) {
  const { data: memberships, error: membershipsError } = await client
    .from('store_members')
    .select('store_id')
    .eq('user_id', userId)

  if (membershipsError) throw membershipsError
  const storeIds = Array.from(new Set((memberships || []).map((row) => String(row.store_id || '')).filter(Boolean)))
  if (storeIds.length === 0) return [] as Array<{ id: string; name: string; logo_url: string | null }>

  const { data: stores, error: storesError } = await client
    .from('stores')
    .select('id, name, logo_url')
    .in('id', storeIds)
    .order('created_at', { ascending: true })

  if (storesError) throw storesError
  return (stores || []) as Array<{ id: string; name: string; logo_url: string | null }>
}

export async function ensureDefaultPricingGroup(client: AdminClient, providerId: string) {
  const { data: existing, error: existingError } = await client
    .from('pricing_groups')
    .select('id')
    .eq('provider_id', providerId)
    .is('user_id', null)
    .is('integration_id', null)
    .eq('is_default', true)
    .eq('name', 'default')
    .maybeSingle()

  if (existingError) throw existingError
  if (existing?.id) return existing.id as string

  const { data, error } = await client
    .from('pricing_groups')
    .insert({
      provider_id: providerId,
      user_id: null,
      integration_id: null,
      name: 'default',
      is_default: true,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    const { data: retry, error: retryError } = await client
      .from('pricing_groups')
      .select('id')
      .eq('provider_id', providerId)
      .is('user_id', null)
      .is('integration_id', null)
      .eq('is_default', true)
      .eq('name', 'default')
      .single()

    if (retryError) throw error
    return retry.id as string
  }

  return data.id as string
}

export async function syncDeliveryStates(client: AdminClient, providerId: string, states: RapidDeliveryState[]) {
  if (states.length === 0) return 0

  const { error } = await client.from('delivery_states').upsert(
    states.map((state) => ({
      provider_id: providerId,
      external_state_id: state.key,
      name: state.state_name,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'provider_id,external_state_id' }
  )

  if (error) throw error
  return states.length
}

export async function syncPricingGroups(params: {
  client: AdminClient
  providerId: string
  integrationId: string
  userId: string
  cities: RapidDeliveryCity[]
}) {
  const { client, providerId, integrationId, userId, cities } = params
  const defaultGroupId = await ensureDefaultPricingGroup(client, providerId)

  const { data: defaultRates, error: defaultRatesError } = await client
    .from('delivery_rates')
    .select('external_city_key, price, cost_refuse, cost_cancel')
    .eq('pricing_group_id', defaultGroupId)

  if (defaultRatesError) throw defaultRatesError

  const now = new Date().toISOString()
  if (!defaultRates || defaultRates.length === 0) {
    const { error: seedError } = await client.from('delivery_rates').upsert(
      cities.map((city) => ({
        pricing_group_id: defaultGroupId,
        provider_id: providerId,
        external_city_key: city.key,
        city_name: city.city_name,
        price: city.cost_delivery,
        cost_refuse: city.cost_refuse,
        cost_cancel: city.cost_cancel,
        updated_at: now,
      })),
      { onConflict: 'pricing_group_id,external_city_key' }
    )

    if (seedError) throw seedError
    return { pricingGroupId: defaultGroupId, isCustom: false }
  }

  const defaultMap = new Map(defaultRates.map((row) => [Number(row.external_city_key), row]))
  const hasCustomPricing = cities.some((city) => {
    const rate = defaultMap.get(Number(city.key))
    if (!rate) return true
    return Number(rate.price || 0) !== Number(city.cost_delivery || 0)
      || Number(rate.cost_refuse || 0) !== Number(city.cost_refuse || 0)
      || Number(rate.cost_cancel || 0) !== Number(city.cost_cancel || 0)
  })

  if (!hasCustomPricing) return { pricingGroupId: defaultGroupId, isCustom: false }

  const customName = `custom_${integrationId}`
  const { data: existingCustom, error: existingCustomError } = await client
    .from('pricing_groups')
    .select('id')
    .eq('integration_id', integrationId)
    .maybeSingle()

  if (existingCustomError) throw existingCustomError

  let customGroupId = String(existingCustom?.id || '')
  if (!customGroupId) {
    const { data: customGroup, error: customGroupError } = await client
      .from('pricing_groups')
      .insert({
        provider_id: providerId,
        user_id: userId,
        integration_id: integrationId,
        name: customName,
        is_default: false,
        updated_at: now,
      })
      .select('id')
      .single()

    if (customGroupError) throw customGroupError
    customGroupId = String(customGroup.id)
  }

  const { error: ratesError } = await client.from('delivery_rates').upsert(
    cities.map((city) => ({
      pricing_group_id: customGroupId,
      provider_id: providerId,
      external_city_key: city.key,
      city_name: city.city_name,
      price: city.cost_delivery,
      cost_refuse: city.cost_refuse,
      cost_cancel: city.cost_cancel,
      updated_at: now,
    })),
    { onConflict: 'pricing_group_id,external_city_key' }
  )

  if (ratesError) throw ratesError
  return { pricingGroupId: customGroupId, isCustom: true }
}

export async function syncDeliveryShops(params: {
  client: AdminClient
  integrationId: string
  providerId: string
  shops: RapidDeliveryShop[]
  mappings: RapidDeliveryShopMappingInput[]
  pricingGroupId: string
}) {
  const { client, integrationId, providerId, shops, mappings, pricingGroupId } = params
  const mappingMap = new Map(mappings.map((item) => [Number(item.externalShopId), item.storeId || null]))
  const now = new Date().toISOString()

  const { error } = await client.from('delivery_shops').upsert(
    shops.map((shop) => ({
      integration_id: integrationId,
      provider_id: providerId,
      external_shop_id: shop.key,
      external_name: shop.name,
      phone: shop.phone || null,
      allow_opening_parcels: Boolean(shop.allow_opening_parcels),
      store_id: mappingMap.get(Number(shop.key)) ?? null,
      pricing_group_id: pricingGroupId,
      updated_at: now,
    })),
    { onConflict: 'integration_id,external_shop_id' }
  )

  if (error) throw error
}

export async function syncLegacyRapidDeliveryData(params: {
  client: AdminClient
  integrationId: string
  userId: string
  storeIds: string[]
  encryptedToken: string
  shops: RapidDeliveryShop[]
  cities: RapidDeliveryCity[]
}) {
  const { client, integrationId, userId, storeIds, encryptedToken, shops, cities } = params
  const now = new Date().toISOString()

  const uniqueStoreIds = Array.from(new Set(storeIds.map((value) => String(value || '').trim()).filter(Boolean)))
  const primaryStoreId = uniqueStoreIds[0] || null

  if (primaryStoreId) {
    const { error: configError } = await client.from('rapid_delivery_configs').upsert(
      {
        integration_id: integrationId,
        user_id: userId,
        store_id: primaryStoreId,
        api_token: encryptedToken,
        updated_at: now,
      },
      { onConflict: 'integration_id' }
    )

    if (configError) throw configError
  }

  if (shops.length > 0) {
    const { error: shopsError } = await client.from('rapid_delivery_shops').upsert(
      shops.map((shop) => ({
        integration_id: integrationId,
        shop_key: shop.key,
        name: shop.name,
        phone: shop.phone || null,
        allow_opening_parcels: Boolean(shop.allow_opening_parcels),
        updated_at: now,
      })),
      { onConflict: 'integration_id,shop_key' }
    )

    if (shopsError) throw shopsError
  }

  if (cities.length > 0) {
    const standardRows = cities.map((city) => ({
      city_key: city.key,
      city_name: city.city_name,
      cost_delivery: city.cost_delivery,
      cost_refuse: city.cost_refuse,
      cost_cancel: city.cost_cancel,
      updated_at: now,
    }))

    const { error: standardError } = await client.from('rapid_delivery_cities_standard').upsert(standardRows, { onConflict: 'city_key' })
    if (standardError) throw standardError

    const { error: citiesError } = await client.from('rapid_delivery_cities').upsert(
      cities.map((city) => ({
        integration_id: integrationId,
        city_key: city.key,
        city_name: city.city_name,
        cost_delivery: city.cost_delivery,
        cost_refuse: city.cost_refuse,
        cost_cancel: city.cost_cancel,
        updated_at: now,
      })),
      { onConflict: 'integration_id,city_key' }
    )

    if (citiesError) throw citiesError
  }
}

export async function getDecryptedIntegrationToken(client: AdminClient, integrationId: string) {
  const { data, error } = await client.from('integrations').select('id, access_token').eq('id', integrationId).single()
  if (error) throw error

  const raw = String(data.access_token || '')
  const decrypted = decryptSecret(raw)

  if (!isEncryptedSecret(raw)) {
    await client.from('integrations').update({ access_token: encryptSecret(decrypted), updated_at: new Date().toISOString() }).eq('id', integrationId)
  }

  return decrypted
}

export async function getRapidDeliveryIntegrationCredentials(client: AdminClient, integrationId: string) {
  const token = await getDecryptedIntegrationToken(client, integrationId)
  const { data, error } = await client.from('integrations').select('store_domain').eq('id', integrationId).single()
  if (error) throw error

  return {
    token,
    baseUrl: resolveRapidDeliveryApiBaseUrl(data?.store_domain),
  }
}