import { DeepSeekProvider } from '@/lib/assistant/providers/deepseek'
import { createAdminClient } from '@/lib/supabase/admin'

type SupabaseLike = ReturnType<typeof createAdminClient>

const DIGYLOG_PROVIDER_ID = 'eeeb5b4f-741b-4d53-b4dd-72a7bd26f9cf'

/** Étapes observables du pipeline de normalisation (pour afficher la progression). */
export type CityNormalizationStage = 'ai_search'

type NormalizeCityParams = {
  rawCity: string
  orderId?: string | null
  supabase?: SupabaseLike
  /** Slug du provider de livraison (obligatoire pour un flux strict) */
  providerSlug: string
  /** Signal d'étape émis pendant la normalisation (ex. appel IA en cours). */
  onStage?: (stage: CityNormalizationStage) => void
  /**
   * Résolution en lecture seule : aucune écriture sur la commande ni sur les
   * alias. Utilisé pour prévisualiser une ville dans l'interface ; le moteur et
   * les règles de correspondance restent strictement identiques.
   */
  preview?: boolean
}

export type NormalizeCityResult = {
  cityName: string
  cityKey: string | null
  source: 'exact_match' | 'common_alias' | 'alias_cache' | 'partial_match' | 'ai_learned' | 'ai_not_found' | 'ai_invalid' | 'ai_failed' | 'no_provider_cities'
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

  if (providerSlug === 'forcelog') {
    // ForceLog : les villes viennent de delivery_rates
    const { data, error } = await supabase
      .from('delivery_rates')
      .select('external_city_key, city_name')
      .eq('provider_id', '422b8621-f708-4e5a-ba50-c9196c214a8a')
      .order('city_name', { ascending: true })

    if (error) throw error
    return (data || []).map((city) => ({
      city_key: String(city.external_city_key),
      city_name: city.city_name,
    }))
  }

  if (providerSlug === 'ameex') {
    const { data, error } = await supabase
      .from('delivery_rates')
      .select('external_city_key, city_name')
      .eq('provider_id', '729e93ed-207f-4281-8ef6-de37006993de')
      .order('city_name', { ascending: true })

    if (error) throw error
    return (data || []).map((city) => ({
      city_key: String(city.external_city_key),
      city_name: city.city_name,
    }))
  }

  if (providerSlug === 'digylog') {
    const { data, error } = await supabase
      .from('delivery_rates')
      .select('external_city_key, city_name')
      .eq('provider_id', DIGYLOG_PROVIDER_ID)
      .order('city_name', { ascending: true })

    if (error) throw error
    return (data || []).map((city) => ({
      city_key: String(city.external_city_key),
      city_name: city.city_name,
    }))
  }

  // Maroc Go Delivery : les villes viennent de delivery_rates (schéma générique)
  if (providerSlug === 'maroc-go-delivery') {
    const { data: provider } = await supabase
      .from('integration_providers')
      .select('id')
      .eq('slug', 'maroc-go-delivery')
      .maybeSingle()

    if (!provider?.id) return []

    const { data, error } = await supabase
      .from('delivery_rates')
      .select('external_city_key, city_name')
      .eq('provider_id', provider.id)
      .order('city_name', { ascending: true })

    if (error) throw error
    return (data || []).map((city) => ({
      city_key: String(city.external_city_key),
      city_name: city.city_name,
    }))
  }

  // Rushliv : les villes viennent de delivery_rates (schéma générique)
  if (providerSlug === 'rushliv') {
    const { data: provider } = await supabase
      .from('integration_providers')
      .select('id')
      .eq('slug', 'rushliv')
      .maybeSingle()

    if (!provider?.id) return []

    const { data, error } = await supabase
      .from('delivery_rates')
      .select('external_city_key, city_name')
      .eq('provider_id', provider.id)
      .order('city_name', { ascending: true })

    if (error) throw error
    return (data || []).map((city) => ({
      city_key: String(city.external_city_key),
      city_name: city.city_name,
    }))
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
): Promise<{ canonical_city_name: string; city_key: string | null } | null> {
  if (providerSlug === 'ozone') return null

  if (providerSlug === 'forcelog') {
    const { data, error } = await supabase
      .from('forcelog_city_aliases')
      .select('canonical_city_name, city_key')
      .eq('alias', normalizedAlias)
      .maybeSingle()

    if (error) throw error
    return data ? { canonical_city_name: data.canonical_city_name, city_key: data.city_key || null } : null
  }

  if (providerSlug === 'ameex') {
    const { data, error } = await supabase
      .from('ameex_city_aliases')
      .select('canonical_city_name, city_key')
      .eq('alias', normalizedAlias)
      .maybeSingle()

    if (error) throw error
    return data ? { canonical_city_name: data.canonical_city_name, city_key: data.city_key || null } : null
  }

  if (providerSlug === 'digylog') {
    const { data, error } = await supabase
      .from('digylog_city_aliases')
      .select('canonical_city_name, city_key')
      .eq('alias', normalizedAlias)
      .maybeSingle()

    if (error) throw error
    return data ? { canonical_city_name: data.canonical_city_name, city_key: data.city_key || null } : null
  }

  if (providerSlug === 'maroc-go-delivery') {
    const { data, error } = await supabase
      .from('maroc_go_delivery_city_aliases')
      .select('canonical_city_name, city_key')
      .eq('alias', normalizedAlias)
      .maybeSingle()

    if (error) throw error
    return data ? { canonical_city_name: data.canonical_city_name, city_key: data.city_key || null } : null
  }

  if (providerSlug === 'rushliv') {
    const { data, error } = await supabase
      .from('rushliv_city_aliases')
      .select('canonical_city_name, city_key')
      .eq('alias', normalizedAlias)
      .maybeSingle()

    if (error) throw error
    return data ? { canonical_city_name: data.canonical_city_name, city_key: data.city_key || null } : null
  }

  const { data, error } = await supabase
    .from('rapid_delivery_city_aliases')
    .select('canonical_city_name, city_key')
    .eq('alias', normalizedAlias)
    .maybeSingle()

  if (error) throw error
  return data ? { canonical_city_name: data.canonical_city_name, city_key: data.city_key || null } : null
}

async function persistAliasForProvider(params: {
  supabase: SupabaseLike
  alias: string
  canonicalCityName: string
  cityKey: string | null
  orderId?: string | null
  source: string
  confidenceScore: number
  providerSlug: string
}) {
  const { supabase, alias, canonicalCityName, cityKey, orderId, source, confidenceScore, providerSlug } = params
  const now = new Date().toISOString()

  if (providerSlug === 'ozone') return

  const table = providerSlug === 'forcelog'
    ? 'forcelog_city_aliases'
    : providerSlug === 'ameex'
      ? 'ameex_city_aliases'
      : providerSlug === 'digylog'
        ? 'digylog_city_aliases'
        : providerSlug === 'maroc-go-delivery'
          ? 'maroc_go_delivery_city_aliases'
          : providerSlug === 'rushliv'
            ? 'rushliv_city_aliases'
            : 'rapid_delivery_city_aliases'

  await supabase.from(table).upsert(
    {
      alias,
      canonical_city_name: canonicalCityName,
      city_key: cityKey || '',
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
  cityKey: string | null,
  providerSlug: string
) {
  const now = new Date().toISOString()

  if (providerSlug === 'ozone') return

  const table = providerSlug === 'forcelog'
    ? 'forcelog_city_aliases'
    : providerSlug === 'ameex'
      ? 'ameex_city_aliases'
      : providerSlug === 'digylog'
        ? 'digylog_city_aliases'
        : providerSlug === 'maroc-go-delivery'
          ? 'maroc_go_delivery_city_aliases'
          : providerSlug === 'rushliv'
            ? 'rushliv_city_aliases'
            : 'rapid_delivery_city_aliases'

  await supabase
    .from(table)
    .update({
      city_key: cityKey || '',
      last_used_at: now,
      updated_at: now,
    })
    .eq('alias', normalizedAlias)
}

async function persistOrderDeliveryCity(params: {
  supabase: SupabaseLike
  orderId?: string | null
  cityName: string
  cityKey: string | null
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
  return match ? String(match.city_key || '') : null
}

/**
 * Borne l'attente de l'IA de normalisation. Sans borne, un fournisseur lent
 * bloque la confirmation ; au-delà du délai le moteur échoue en `ai_failed` et
 * l'agent sélectionne la ville manuellement. Aucun quota n'est introduit ici.
 */
const DEFAULT_AI_TIMEOUT_MS = 8000

function resolveAiTimeoutMs() {
  const configured = Number(process.env.CITY_NORMALIZATION_AI_TIMEOUT_MS || 0)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_AI_TIMEOUT_MS
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CITY_NORMALIZATION_AI_TIMEOUT')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

async function resolveWithDeepSeek(rawCity: string, candidates: string[]) {
  const provider = new DeepSeekProvider()
  const normalizedModel = String(process.env.DEEPSEEK_MODEL || 'deepseek-chat')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')

  const result = await withTimeout(
    provider.chat({
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
    }),
    resolveAiTimeoutMs()
  )

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
    const cityKey = String(exactMatch.city_key || '') || null
    console.log('[city-normalizer] exact-match', {
      rawCity,
      matchedCity: exactMatch.city_name,
      cityKey,
    })
    if (!params.preview && params.orderId) {
      await persistOrderDeliveryCity({
        supabase,
        orderId: params.orderId,
        cityName: exactMatch.city_name,
        cityKey,
      })
    }
    return {
      cityName: exactMatch.city_name,
      cityKey,
      source: 'exact_match',
      learned: false,
      finalStage: 'exact_match',
    }
  }

  // 3. Alias en cache
  const cachedAlias = await findAliasForProvider(supabase, normalizedAlias, params.providerSlug)
  if (cachedAlias) {
    // La clé mémorisée peut être fausse : un alias appris avec la clé d'une autre
    // ville envoie le colis au mauvais endroit (ex. « الدارالبيضاء » mémorisé sur
    // la clé de MOULAY ABDELLAH au lieu de casablanca). Le nom canonique du
    // catalogue fait donc foi ; la clé mémorisée ne sert que si ce nom n'existe
    // pas dans le catalogue du transporteur.
    const catalogueKey = resolveCityKeyFromCandidates(cachedAlias.canonical_city_name, cities)
    const cachedCityKey = cachedAlias.city_key ? String(cachedAlias.city_key) : ''
    const cachedKeyInCatalogue =
      cachedCityKey !== '' && cities.some((city) => String(city.city_key) === cachedCityKey)
    const repairedCityKey = catalogueKey || (cachedKeyInCatalogue ? cachedCityKey : null)
    const resolvedCityName =
      (catalogueKey
        ? cities.find((city) => String(city.city_key) === catalogueKey)?.city_name
        : null) || String(cachedAlias.canonical_city_name || '').trim()

    console.log('[city-normalizer] alias-cache-hit', {
      rawCity,
      normalizedAlias,
      canonicalCityName: resolvedCityName,
      cityKey: repairedCityKey,
      cachedCityKey: cachedCityKey || null,
      keyRepaired: Boolean(catalogueKey && cachedCityKey && catalogueKey !== cachedCityKey),
    })

    if (!params.preview) {
      // La clé corrigée est réenregistrée : l'alias fautif se répare à l'usage.
      await updateAliasUsage(supabase, normalizedAlias, repairedCityKey, params.providerSlug)
    }

    if (!params.preview && params.orderId) {
      await persistOrderDeliveryCity({
        supabase,
        orderId: params.orderId,
        cityName: resolvedCityName,
        cityKey: repairedCityKey,
      })
    }

    return {
      cityName: resolvedCityName,
      cityKey: repairedCityKey,
      source: 'alias_cache',
      learned: false,
      finalStage: 'alias_cache',
    }
  }

  // 3b. Correspondance partielle : un nom de ville connu apparaît n'importe où
  // dans la ville brute (début, milieu ou fin), en mot entier — ex.
  // « Boumia tichiait », « tichiait Boumia », « Villa Boumia 12 » → « BOUMIA ».
  // `normalizeAlias` ne conserve que lettres/chiffres/espaces : le motif est donc
  // borné par des espaces, sans échappement nécessaire. On n'accepte qu'une
  // correspondance unique pour éviter toute ambiguïté (sinon DeepSeek tranche).
  const partialMatches = cities.filter((city) => {
    const cityNorm = normalizeAlias(city.city_name)
    if (cityNorm.length < 3) return false
    return new RegExp(`(?:^| )${cityNorm}(?: |$)`).test(normalizedAlias)
  })

  if (partialMatches.length === 1) {
    const match = partialMatches[0]
    const cityKey = String(match.city_key || '') || null

    console.log('[city-normalizer] partial-match', {
      rawCity,
      matchedCity: match.city_name,
      cityKey,
    })

    if (!params.preview) {
      await persistAliasForProvider({
        supabase,
        alias: normalizedAlias,
        canonicalCityName: match.city_name,
        cityKey,
        orderId: params.orderId,
        source: 'partial_match',
        confidenceScore: 0.9,
        providerSlug: params.providerSlug,
      })
    }

    if (!params.preview && params.orderId) {
      await persistOrderDeliveryCity({
        supabase,
        orderId: params.orderId,
        cityName: match.city_name,
        cityKey,
      })
    }

    return {
      cityName: match.city_name,
      cityKey,
      source: 'partial_match',
      learned: true,
      finalStage: 'partial_match',
    }
  }

  // 4. DeepSeek
  params.onStage?.('ai_search')
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

  const aiCityKey = String(aiCity.city_key || '') || resolveCityKeyFromCandidates(aiCity.city_name, cities)

  if (!params.preview) {
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
  }

  console.log('[city-normalizer] ai-learned-alias-created', {
    rawCity,
    normalizedAlias,
    canonicalCityName: aiCity.city_name,
    cityKey: aiCityKey,
  })

  if (!params.preview && params.orderId) {
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

export async function normalizeOrderCityById(
  orderId: string,
  supabase?: SupabaseLike,
  providerSlug?: string,
  onStage?: (stage: CityNormalizationStage) => void
) {
  const admin = supabase || createAdminClient()
  const { data: order, error } = await admin.from('orders').select('id, city').eq('id', orderId).maybeSingle()
  if (error) throw error
  if (!order?.city) {
    return { cityName: '', cityKey: null, source: 'exact_match' as const, learned: false }
  }

  return normalizeCityName({
    rawCity: order.city,
    orderId: order.id,
    supabase: admin,
    providerSlug: providerSlug || 'rapid-delivery',
    onStage,
  })
}
