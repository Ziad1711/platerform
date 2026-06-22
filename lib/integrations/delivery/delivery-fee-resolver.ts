import { createAdminClient } from '@/lib/supabase/admin'

type SupabaseLike = ReturnType<typeof createAdminClient>

/**
 * Résout les frais de livraison (delivery_fee) pour une ville donnée,
 * en utilisant le nouveau schéma générique (pricing_groups + delivery_rates)
 * comme source de vérité, avec fallback sur les tables legacy.
 *
 * Logique :
 * 1. Récupère l'intégration Rapid Delivery active pour le store
 * 2. Trouve le pricing_group_id associé au shop (via delivery_shops)
 * 3. Cherche le prix dans delivery_rates pour ce pricing_group + cityKey
 * 4. Fallback : rapid_delivery_cities_standard
 * 5. Fallback : rapid_delivery_cities
 */
export async function resolveDeliveryFee(params: {
  supabase?: SupabaseLike
  storeId: string
  cityKey: number | string
  integrationId?: string | null
  providerSlug?: string
}): Promise<number> {
  const supabase = params.supabase || createAdminClient()
  const { storeId } = params
  const cityKey = String(params.cityKey)
  const providerSlug = params.providerSlug || 'rapid-delivery'

  // 1. Récupérer le provider réel (source générique delivery_rates)
  const { data: provider } = await supabase
    .from('integration_providers')
    .select('id')
    .eq('slug', providerSlug)
    .maybeSingle()

  if (!provider?.id) {
    return fallbackStandardRate(supabase, cityKey)
  }

  // 2. Trouver le pricing_group_id via delivery_shops du store
  let shopQuery = supabase
    .from('delivery_shops')
    .select('pricing_group_id')
    .eq('provider_id', provider.id)
    .eq('store_id', storeId)
    .not('pricing_group_id', 'is', null)
    .order('external_shop_id', { ascending: true })
    .limit(1)

  if (params.integrationId) {
    shopQuery = shopQuery.eq('integration_id', params.integrationId)
  }

  const { data: shop } = await shopQuery
    .maybeSingle()

  if (shop?.pricing_group_id) {
    // 3. Chercher dans delivery_rates
    const { data: rate } = await supabase
      .from('delivery_rates')
      .select('price')
      .eq('pricing_group_id', shop.pricing_group_id)
      .eq('external_city_key', cityKey)
      .maybeSingle()

    if (rate?.price !== undefined && rate?.price !== null) {
      return Number(rate.price)
    }
  }

  // 4. Fallback sur le pricing group par défaut du provider
  const { data: defaultGroup } = await supabase
    .from('pricing_groups')
    .select('id')
    .eq('provider_id', provider.id)
    .eq('is_default', true)
    .is('integration_id', null)
    .maybeSingle()

  if (defaultGroup?.id) {
    const { data: defaultRate } = await supabase
      .from('delivery_rates')
      .select('price')
      .eq('pricing_group_id', defaultGroup.id)
      .eq('external_city_key', cityKey)
      .maybeSingle()

    if (defaultRate?.price !== undefined && defaultRate?.price !== null) {
      return Number(defaultRate.price)
    }
  }

  // 5. Fallback : delivery_rates direct provider
  if (providerSlug === 'forcelog' || providerSlug === 'ameex' || providerSlug === 'sendit') {
    const { data: rate } = await supabase
      .from('delivery_rates')
      .select('price')
      .eq('provider_id', provider.id)
      .eq('external_city_key', cityKey)
      .maybeSingle()

    if (rate?.price !== undefined && rate?.price !== null) {
      return Number(rate.price)
    }
    return 0
  }

  // 6. Fallback legacy Rapid Delivery
  return fallbackStandardRate(supabase, cityKey)
}

async function fallbackStandardRate(
  supabase: SupabaseLike,
  cityKey: string
): Promise<number> {
  const numericKey = Number(cityKey) || 0
  const { data: standard } = await supabase
    .from('rapid_delivery_cities_standard')
    .select('cost_delivery')
    .eq('city_key', numericKey)
    .maybeSingle()

  if (standard?.cost_delivery !== undefined && standard?.cost_delivery !== null) {
    return Number(standard.cost_delivery)
  }

  // 5. Fallback ultime : rapid_delivery_cities
  const { data: legacy } = await supabase
    .from('rapid_delivery_cities')
    .select('cost_delivery')
    .eq('city_key', numericKey)
    .limit(1)
    .maybeSingle()

  return Number(legacy?.cost_delivery || 0)
}
