import { DeepSeekProvider } from '@/lib/assistant/providers/deepseek'
import { createAdminClient } from '@/lib/supabase/admin'

type SupabaseLike = ReturnType<typeof createAdminClient>

type NormalizeCityParams = {
  rawCity: string
  orderId?: string | null
  supabase?: SupabaseLike
  /** Slug du provider de livraison (obligatoire pour un flux strict) */
  providerSlug: string
}

export type NormalizeCityResult = {
  cityName: string
  cityKey: number | null
  source: 'exact_match' | 'common_alias' | 'alias_cache' | 'ai_learned' | 'ai_not_found' | 'ai_invalid' | 'ai_failed' | 'no_provider_cities'
  learned: boolean
  /** Étape finale atteinte dans le pipeline de normalisation */
  finalStage: string
}

// ============================================================
// Tables par provider
// ============================================================

async function listCitiesForProvider(supabase: SupabaseLike, providerSlug: string) {
  if (providerSlug === 'ozone') {
    // Ozone est volontairement exclu du flux IA/alias.
    // La ville Ozone doit être choisie manuellement dans le modal de confirmation.
    return []
  }

  // Rapid Delivery : rapid_delivery_cities_standard
  const { data, error } = await supabase
    .from('rapid_delivery_cities_standard')
    .select('city_key, city_name')
    .order('city_name', { ascending: true })

  if (error) throw error
  if ((data || []).length > 0) return data || []

  // Fallback legacy Rapid
  const { data: legacy, error: legacyError } = await supabase
    .from('rapid_delivery_cities')
    .select('city_key, city_name')
    .order('city_name', { ascending: true })

  if (legacyError) throw legacyError

  return Array.from(
    new Map(
      (legacy || []).map((city) => [Number(city.city_key || 0), city])
    ).values()
  )
}

async function findAliasForProvider(
  supabase: SupabaseLike,
  normalizedAlias: string,
  providerSlug: string
): Promise<{ canonical_city_name: string; city_key: number | null } | null> {
  if (providerSlug === 'ozone') return null

  const { data, error } = await supabase
    .from('rapid_delivery_city_aliases')
    .select('canonical_city_name, city_key')
    .eq('alias', normalizedAlias)
    .maybeSingle()

  if (error) throw error
  return data || null
}

async function persistAliasForProvider(params: {
  supabase: SupabaseLike
  alias: string
  canonicalCityName: string
  cityKey: number | null
  orderId?: string | null
  source: string
  confidenceScore: number
  providerSlug: string
}) {
  const { supabase, alias, canonicalCityName, cityKey, orderId, source, confidenceScore, providerSlug } = params
  const now = new Date().toISOString()

  if (providerSlug === 'ozone') return

  await supabase.from('rapid_delivery_city_aliases').upsert(
    {
      alias,
      canonical_city_name: canonicalCityName,
      city_key: cityKey,
      learned_from_order_id: orderId || null,
      learned_at: now,
      last_used_at: now,
      usage_count: 1,
      source,
      confidence_score: confidenceScore,
      updated_at: now,
    },
    { onConflict: 'alias' }
  )
}

async function updateAliasUsage(
  supabase: SupabaseLike,
  normalizedAlias: string,
  cityKey: number | null,
  providerSlug: string
) {
  const now = new Date().toISOString()

  if (providerSlug === 'ozone') return

  await supabase
    .from('rapid_delivery_city_aliases')
    .update({
      city_key: cityKey,
      last_used_at: now,
      updated_at: now,
    })
    .eq('alias', normalizedAlias)
}

async function persistOrderDeliveryCity(params: {
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
      delivery_city_external_id: params.cityKey,
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
  SAFI: ['asafi', 'safi', 'اسفي', 'أسفي'],
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

/**
 * Normalise un nom de ville en fonction du provider de livraison.
 *
 * Flux strict par provider :
 * 1. Chercher dans la table des villes du provider
 * 2. Chercher dans rapid_delivery_city_aliases
 * 3. DeepSeek avec la liste des villes Rapid
 * 4. Sauvegarder l'alias dans rapid_delivery_city_aliases
 * 6. Sauvegarder le résultat dans orders.delivery_city_external_id
 */
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
    providerSlug: params.providerSlug,
  })

  // 1. Charger les villes du provider
  const cities = await listCitiesForProvider(supabase, params.providerSlug)
  console.log('[city-normalizer] cities-loaded', { count: cities.length, providerSlug: params.providerSlug })

  if (cities.length === 0) {
    console.warn('[city-normalizer] no-cities-for-provider', { providerSlug: params.providerSlug })
    return {
      cityName: rawCity,
      cityKey: null,
      source: 'no_provider_cities',
      learned: false,
      finalStage: 'no_provider_cities',
    }
  }

  // 2. Exact match
  const exactMatch = cities.find((city) => normalizeAlias(city.city_name) === normalizedAlias)
  if (exactMatch) {
    console.log('[city-normalizer] exact-match', {
      rawCity,
      matchedCity: exactMatch.city_name,
      cityKey: exactMatch.city_key,
    })
    if (params.orderId) {
      await persistOrderDeliveryCity({
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
      finalStage: 'exact_match',
    }
  }

  // 3. Alias en cache Rapid Delivery
  const cachedAlias = await findAliasForProvider(supabase, normalizedAlias, params.providerSlug)
  if (cachedAlias) {
    const repairedCityKey =
      Number(cachedAlias.city_key || 0) || resolveCityKeyFromCandidates(cachedAlias.canonical_city_name, cities)

    console.log('[city-normalizer] alias-cache-hit', {
      rawCity,
      normalizedAlias,
      canonicalCityName: cachedAlias.canonical_city_name,
      cityKey: repairedCityKey,
    })

    await updateAliasUsage(supabase, normalizedAlias, repairedCityKey, params.providerSlug)

    if (params.orderId) {
      await persistOrderDeliveryCity({
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
      finalStage: 'alias_cache',
    }
  }

  // 4. DeepSeek
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
      finalStage: 'ai_failed',
    }
  }

  const cleanedResolvedCityName = sanitizeModelCityResponse(resolvedCityName)
  console.log('[city-normalizer] deepseek-cleaned-response', {
    rawCity,
    normalizedAlias,
    cleanedResolvedCityName,
  })

  if (!cleanedResolvedCityName || cleanedResolvedCityName.toUpperCase() === 'NOT_FOUND') {
    console.warn('[city-normalizer] deepseek-not-found', { rawCity, normalizedAlias })
    return {
      cityName: rawCity,
      cityKey: null,
      source: 'ai_not_found',
      learned: false,
      finalStage: 'ai_not_found',
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
      source: 'ai_invalid',
      learned: false,
      finalStage: 'ai_invalid',
    }
  }

  const aiCityKey = Number(aiCity.city_key || 0) || resolveCityKeyFromCandidates(aiCity.city_name, cities)

  await persistAliasForProvider({
    supabase,
    alias: normalizedAlias,
    canonicalCityName: aiCity.city_name,
    cityKey: aiCityKey,
    orderId: params.orderId,
    source: 'ai_learned',
    confidenceScore: 0.9,
    providerSlug: params.providerSlug,
  })

  console.log('[city-normalizer] ai-learned-alias-created', {
    rawCity,
    normalizedAlias,
    canonicalCityName: aiCity.city_name,
    cityKey: aiCityKey,
  })

  if (params.orderId) {
    await persistOrderDeliveryCity({
      supabase,
      orderId: params.orderId,
      cityName: aiCity.city_name,
      cityKey: aiCityKey,
    })
  }

  return {
    cityName: aiCity.city_name,
    cityKey: aiCityKey,
    source: 'ai_learned',
    learned: true,
    finalStage: 'ai_learned',
  }
}

export async function normalizeOrderCityById(orderId: string, supabase?: SupabaseLike, providerSlug?: string) {
  const admin = supabase || createAdminClient()
  const { data: order, error } = await admin.from('orders').select('id, city').eq('id', orderId).maybeSingle()
  if (error) throw error
  if (!order?.city) {
    return { cityName: '', cityKey: null, source: 'exact_match' as const, learned: false }
  }

  return normalizeCityName({ rawCity: order.city, orderId: order.id, supabase: admin, providerSlug: providerSlug || 'rapid-delivery' })
}
