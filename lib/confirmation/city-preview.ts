/**
 * Prévisualisation de la ville d'une commande pour les transporteurs dont la
 * ville est détectée automatiquement dans `/sales` (Maroc Go, Rapid, Rushliv).
 *
 * La résolution est strictement en lecture seule : ni la commande ni les alias
 * ne sont modifiés à l'ouverture du dialogue. Le moteur reste celui du serveur
 * (`/api/orders/normalize-city`) : ce module ne fait que partager la requête
 * entre le préremplissage et la tentative lancée au clic sur « Confirmer ».
 */

import type {
  ConfirmationDeliveryOptions,
  ConfirmationDeliveryProvider,
} from './delivery-options'

export type CityPreview = {
  cityKey: string
  cityName: string
  source?: string
}

/** Seuls ces transporteurs bénéficient de la détection automatique. */
export const CITY_PREVIEW_PROVIDERS: ConfirmationDeliveryProvider[] = [
  'rapid-delivery',
  'maroc-go-delivery',
  'rushliv',
]

/** Champs de ville concernés par transporteur. */
export const SLUG_CITY_FIELDS: Partial<
  Record<
    ConfirmationDeliveryProvider,
    { key: keyof ConfirmationDeliveryOptions; name: keyof ConfirmationDeliveryOptions }
  >
> = {
  'maroc-go-delivery': { key: 'marocGoCityKey', name: 'marocGoCityName' },
  'rapid-delivery': { key: 'rapidCityKey', name: 'rapidCityName' },
  rushliv: { key: 'rushlivCityKey', name: 'rushlivCityName' },
}

export function isCityPreviewProvider(
  provider: string | null | undefined
): provider is 'rapid-delivery' | 'maroc-go-delivery' | 'rushliv' {
  return CITY_PREVIEW_PROVIDERS.includes(provider as ConfirmationDeliveryProvider)
}

/** Clé de cache : une recherche est identifiée par transporteur, commande et ville source. */
export function cityPreviewQueryKey(
  provider: string,
  orderId: string | null | undefined,
  rawCity: string
) {
  return ['confirmation-city-resolution', provider, orderId || null, rawCity] as const
}

/**
 * Applique la ville résolue aux seuls champs du transporteur, sans écraser les
 * autres options colis déjà choisies par l'agent.
 */
export function withResolvedCity(
  provider: ConfirmationDeliveryProvider,
  options: ConfirmationDeliveryOptions,
  city: CityPreview
): ConfirmationDeliveryOptions {
  const fields = SLUG_CITY_FIELDS[provider]
  if (!fields) return options
  const next: ConfirmationDeliveryOptions = { ...options }
  ;(next as Record<string, unknown>)[fields.key as string] = city.cityKey
  ;(next as Record<string, unknown>)[fields.name as string] = city.cityName
  return next
}

/** Réponse normalisée de l'API : `null` dès qu'aucune ville fiable n'est trouvée. */
export async function fetchCityPreview(params: {
  provider: ConfirmationDeliveryProvider
  orderId: string | null | undefined
  rawCity: string
}): Promise<CityPreview | null> {
  const rawCity = String(params.rawCity || '').trim()
  if (!rawCity || !params.orderId) return null

  const response = await fetch('/api/orders/normalize-city', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      city: rawCity,
      orderId: params.orderId,
      providerSlug: params.provider,
      preview: true,
    }),
  })
  if (!response.ok) return null

  const payload = (await response.json().catch(() => null)) as {
    cityKey?: string | null
    cityName?: string | null
    source?: string | null
  } | null
  const cityKey = payload?.cityKey ? String(payload.cityKey) : ''
  if (!cityKey) return null

  return {
    cityKey,
    cityName: String(payload?.cityName || rawCity),
    source: payload?.source ? String(payload.source) : undefined,
  }
}
