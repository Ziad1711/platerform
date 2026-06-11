import { DeepSeekProvider } from '@/lib/assistant/providers/deepseek'
import { createAdminClient } from '@/lib/supabase/admin'

type SupabaseLike = ReturnType<typeof createAdminClient>

type NormalizeCityParams = {
  rawCity: string
  orderId?: string | null
  supabase?: SupabaseLike
}

export type NormalizeCityResult = {
  cityName: string
  cityKey: number | null
  source: 'exact_match' | 'alias_cache' | 'ai_learned' | 'ai_failed'
  learned: boolean
}

async function persistOrderRapidDeliveryCity(params: {
  supabase: SupabaseLike
  orderId?: string | null
  cityName: string
  cityKey: number | null
}) {
  if (!params.orderId) return

  await params.supabase
    .from('orders')
    .update({
      city: params.cityName,
      rapid_delivery_city_key: params.cityKey,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.orderId)
}

function normalizeAlias(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const COMMON_CITY_ALIASES: Record<string, string[]> = {
  Casablanca: ['casa', 'casa blanca', 'casablanca', 'الدار البيضاء', 'الدارالبيضاء'],
  Rabat: ['rabat'],
  Marrakech: ['marrakech', 'marrakesh', 'kech', 'مراكش'],
}

function resolveCommonAlias(rawAlias: string, candidates: Array<{ city_name: string; city_key: number | string }>) {
  for (const [canonicalName, aliases] of Object.entries(COMMON_CITY_ALIASES)) {
    if (!aliases.includes(rawAlias)) continue
    const match = candidates.find((city) => normalizeAlias(city.city_name) === normalizeAlias(canonicalName))
    if (match) return match
  }

  return null
}

function sanitizeModelCityResponse(value: string) {
  return String(value || '')
    .trim()
    .replace(/^['"`\s]+|['"`\s]+$/g, '')
    .replace(/[.،,;:!?]+$/g, '')
    .trim()
}

function resolveCityKeyFromCandidates(
  cityName: string,
  candidates: Array<{ city_name: string; city_key: number | string }>
) {
  const match = candidates.find((city) => normalizeAlias(city.city_name) === normalizeAlias(cityName))
  return Number(match?.city_key || 0) || null
}

async function listStandardCities(supabase: SupabaseLike) {
  // Priorité 1: delivery_rates du pricing group par défaut
  const { data: defaultGroup, error: groupError } = await supabase
    .from('pricing_groups')
    .select('id')
    .eq('is_default', true)
    .maybeSingle()

  if (!groupError && defaultGroup?.id) {
    const { data: rates, error: ratesError } = await supabase
      .from('delivery_rates')
      .select('external_city_key, city_name')
      .eq('pricing_group_id', defaultGroup.id)
      .order('city_name', { ascending: true })

    if (!ratesError && (rates || []).length > 0) {
      return (rates || []).map((r) => ({
        city_key: Number(r.external_city_key || 0),
        city_name: r.city_name,
      }))
    }
  }

  // Priorité 2: rapid_delivery_cities_standard
  const { data, error } = await supabase
    .from('rapid_delivery_cities_standard')
    .select('city_key, city_name')
    .order('city_name', { ascending: true })

  if (error) throw error
  if ((data || []).length > 0) {
    return data || []
  }

  console.warn('[city-normalizer] standard-cities-empty-fallback-to-integration-cities')

  // Priorité 3: rapid_delivery_cities (legacy)
  const { data: integrationCities, error: integrationCitiesError } = await supabase
    .from('rapid_delivery_cities')
    .select('city_key, city_name')
    .order('city_name', { ascending: true })

  if (integrationCitiesError) throw integrationCitiesError

  const deduped = Array.from(
    new Map(
      (integrationCities || []).map((city) => [Number(city.city_key || 0), city])
    ).values()
  )

  return deduped
}

async function resolveWithDeepSeek(rawCity: string, candidates: string[]) {
  const provider = new DeepSeekProvider()
  const normalizedModel = String(process.env.DEEPSEEK_MODEL || 'deepseek-chat')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')

  const result = await provider.chat({
    model: normalizedModel || 'deepseek-chat',
    systemPrompt:
      'Tu normalises uniquement des noms de villes marocaines. Réponds strictement avec un seul nom exact issu de la liste fournie, sans explication, sans ponctuation supplémentaire, ou NOT_FOUND si aucune ville ne correspond.',
    messages: [
      {
        role: 'user',
        content: [
          `Ville à normaliser: ${rawCity}`,
          'Exemples: casa -> Casablanca, rabat -> Rabat, marrakech -> Marrakech.',
          `Villes disponibles: ${candidates.join(', ')}`,
          'Choisis strictement un nom présent dans la liste. Si aucune correspondance fiable n\'existe, réponds uniquement NOT_FOUND.',
        ].join('\n'),
      },
    ],
  })

  return String(result.text || '').trim()
}

export async function normalizeCityName(params: NormalizeCityParams): Promise<NormalizeCityResult> {
  const rawCity = String(params.rawCity || '').trim()
  if (!rawCity) {
    throw new Error('Ville manquante.')
  }

  const supabase = params.supabase || createAdminClient()
  const normalizedAlias = normalizeAlias(rawCity)
  if (!normalizedAlias) {
    throw new Error('Ville invalide.')
  }

  console.log('[city-normalizer] start', {
    rawCity,
    normalizedAlias,
    orderId: params.orderId || null,
  })

  const cities = await listStandardCities(supabase)
  console.log('[city-normalizer] standard-cities-loaded', { count: cities.length })
  if (cities.length === 0) {
    console.warn('[city-normalizer] no-standard-cities-found')
    return {
      cityName: rawCity,
      cityKey: null,
      source: 'exact_match',
      learned: false,
    }
  }

  const exactMatch = cities.find((city) => normalizeAlias(city.city_name) === normalizedAlias)
  if (exactMatch) {
    console.log('[city-normalizer] exact-match', {
      rawCity,
      matchedCity: exactMatch.city_name,
      cityKey: exactMatch.city_key,
    })
    if (params.orderId) {
      await persistOrderRapidDeliveryCity({
        supabase,
        orderId: params.orderId,
        cityName: exactMatch.city_name,
        cityKey: Number(exactMatch.city_key || 0) || null,
      })
    }

    return {
      cityName: exactMatch.city_name,
      cityKey: Number(exactMatch.city_key || 0) || null,
      source: 'exact_match',
      learned: false,
    }
  }

  const commonAliasMatch = resolveCommonAlias(normalizedAlias, cities)
  if (commonAliasMatch) {
    const resolvedCityKey = Number(commonAliasMatch.city_key || 0) || resolveCityKeyFromCandidates(commonAliasMatch.city_name, cities)
    console.log('[city-normalizer] common-alias-match', {
      rawCity,
      normalizedAlias,
      matchedCity: commonAliasMatch.city_name,
      cityKey: resolvedCityKey,
    })
    await supabase.from('rapid_delivery_city_aliases').upsert(
      {
        alias: normalizedAlias,
        canonical_city_name: commonAliasMatch.city_name,
        city_key: resolvedCityKey,
        learned_from_order_id: params.orderId || null,
        learned_at: new Date().toISOString(),
        last_used_at: new Date().toISOString(),
        usage_count: 1,
        source: 'ai_learned',
        confidence_score: 0.95,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'alias' }
    )

    if (params.orderId) {
      await persistOrderRapidDeliveryCity({
        supabase,
        orderId: params.orderId,
        cityName: commonAliasMatch.city_name,
        cityKey: resolvedCityKey,
      })
    }

    return {
      cityName: commonAliasMatch.city_name,
      cityKey: resolvedCityKey,
      source: 'ai_learned',
      learned: true,
    }
  }

  const { data: cachedAlias, error: aliasError } = await supabase
    .from('rapid_delivery_city_aliases')
    .select('canonical_city_name, city_key, usage_count')
    .eq('alias', normalizedAlias)
    .maybeSingle()

  if (aliasError) throw aliasError

  if (cachedAlias) {
    const repairedCityKey =
      Number(cachedAlias.city_key || 0) || resolveCityKeyFromCandidates(cachedAlias.canonical_city_name, cities)

    console.log('[city-normalizer] alias-cache-hit', {
      rawCity,
      normalizedAlias,
      canonicalCityName: cachedAlias.canonical_city_name,
      cityKey: repairedCityKey,
      previousUsageCount: cachedAlias.usage_count,
    })
    await supabase
      .from('rapid_delivery_city_aliases')
      .update({
        city_key: repairedCityKey,
        usage_count: Number(cachedAlias.usage_count || 0) + 1,
        last_used_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('alias', normalizedAlias)

    if (params.orderId) {
      await persistOrderRapidDeliveryCity({
        supabase,
        orderId: params.orderId,
        cityName: cachedAlias.canonical_city_name,
        cityKey: repairedCityKey,
      })
    }

    return {
      cityName: cachedAlias.canonical_city_name,
      cityKey: repairedCityKey,
      source: 'alias_cache',
      learned: false,
    }
  }

  let resolvedCityName = ''
  try {
    resolvedCityName = await resolveWithDeepSeek(rawCity, cities.map((city) => city.city_name))
    console.log('[city-normalizer] deepseek-raw-response', {
      rawCity,
      normalizedAlias,
      resolvedCityName,
    })
  } catch (error) {
    console.error('[city-normalizer] DeepSeek failed:', error)
    return {
      cityName: rawCity,
      cityKey: null,
      source: 'ai_failed',
      learned: false,
    }
  }

  const cleanedResolvedCityName = sanitizeModelCityResponse(resolvedCityName)
  console.log('[city-normalizer] deepseek-cleaned-response', {
    rawCity,
    normalizedAlias,
    cleanedResolvedCityName,
  })

  if (!cleanedResolvedCityName || cleanedResolvedCityName.toUpperCase() === 'NOT_FOUND') {
    console.warn('[city-normalizer] deepseek-not-found', {
      rawCity,
      normalizedAlias,
    })
    return {
      cityName: rawCity,
      cityKey: null,
      source: 'ai_learned',
      learned: false,
    }
  }

  const aiCity = cities.find((city) => normalizeAlias(city.city_name) === normalizeAlias(cleanedResolvedCityName))
  if (!aiCity) {
    console.warn('[city-normalizer] deepseek-response-not-in-list', {
      rawCity,
      normalizedAlias,
      cleanedResolvedCityName,
    })
    return {
      cityName: rawCity,
      cityKey: null,
      source: 'ai_learned',
      learned: false,
    }
  }

  await supabase.from('rapid_delivery_city_aliases').upsert(
    {
      alias: normalizedAlias,
      canonical_city_name: aiCity.city_name,
      city_key: Number(aiCity.city_key || 0) || resolveCityKeyFromCandidates(aiCity.city_name, cities),
      learned_from_order_id: params.orderId || null,
      learned_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
      usage_count: 1,
      source: 'ai_learned',
      confidence_score: 0.9,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'alias' }
  )

  console.log('[city-normalizer] ai-learned-alias-created', {
    rawCity,
    normalizedAlias,
    canonicalCityName: aiCity.city_name,
    cityKey: Number(aiCity.city_key || 0) || resolveCityKeyFromCandidates(aiCity.city_name, cities),
  })

  if (params.orderId) {
    await persistOrderRapidDeliveryCity({
      supabase,
      orderId: params.orderId,
      cityName: aiCity.city_name,
      cityKey: Number(aiCity.city_key || 0) || resolveCityKeyFromCandidates(aiCity.city_name, cities),
    })
  }

  return {
    cityName: aiCity.city_name,
    cityKey: Number(aiCity.city_key || 0) || resolveCityKeyFromCandidates(aiCity.city_name, cities),
    source: 'ai_learned',
    learned: true,
  }
}

export async function normalizeOrderCityById(orderId: string, supabase?: SupabaseLike) {
  const admin = supabase || createAdminClient()
  const { data: order, error } = await admin.from('orders').select('id, city').eq('id', orderId).maybeSingle()
  if (error) throw error
  if (!order?.city) {
    return { cityName: '', cityKey: null, source: 'exact_match' as const, learned: false }
  }

  return normalizeCityName({ rawCity: order.city, orderId: order.id, supabase: admin })
}
