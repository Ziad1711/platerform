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
  cityKey: number
}): Promise<number> {
  const supabase = params.supabase || createAdminClient()
  const { storeId, cityKey } = params

  // 1. Récupérer l'intégration Rapid Delivery
  const { data: integration } = await supabase
    .from('integrations')
    .select('id')
    .eq('provider', 'rapid-delivery')
    .eq('store_id', storeId)
    .eq('status', 'connected')
    .maybeSingle()

  if (!integration?.id) {
    // Fallback direct sur rapid_delivery_cities_standard
    return fallbackStandardRate(supabase, cityKey)
  }

  // 2. Trouver le pricing_group_id via delivery_shops
  const { data: shop } = await supabase
    .from('delivery_shops')
    .select('pricing_group_id')
    .eq('integration_id', integration.id)
    .eq('store_id', storeId)
    .not('pricing_group_id', 'is', null)
    .order('external_shop_id', { ascending: true })
    .limit(1)
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

  // 4. Fallback : rapid_delivery_cities_standard
  return fallbackStandardRate(supabase, cityKey)
}

async function fallbackStandardRate(
  supabase: SupabaseLike,
  cityKey: number
): Promise<number> {
  const { data: standard } = await supabase
    .from('rapid_delivery_cities_standard')
    .select('cost_delivery')
    .eq('city_key', cityKey)
    .maybeSingle()

  if (standard?.cost_delivery !== undefined && standard?.cost_delivery !== null) {
    return Number(standard.cost_delivery)
  }

  // 5. Fallback ultime : rapid_delivery_cities
  const { data: legacy } = await supabase
    .from('rapid_delivery_cities')
    .select('cost_delivery')
    .eq('city_key', cityKey)
    .limit(1)
    .maybeSingle()

  return Number(legacy?.cost_delivery || 0)
}
