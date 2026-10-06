/**
 * Paramètres colis par transporteur utilisés par la confirmation.
 *
 * Les mêmes champs que `/sales` sont utilisés : ils sont transmis tels quels à
 * `/api/orders/status` qui pilote les adapters transporteurs. Aucun champ d'un
 * transporteur ne doit être envoyé pour un autre transporteur.
 */

/** Identifiants des providers dans `delivery_rates` (catalogue de villes). */
export const DELIVERY_PROVIDER_IDS = {
  ozone: '5f806347-45f1-481a-901d-2eb98b20b3a8',
  ameex: '729e93ed-207f-4281-8ef6-de37006993de',
  sendit: '5998e563-96ed-47cc-881a-43f41827f858',
} as const

export type ConfirmationDeliveryProvider = 'ozone' | 'forcelog' | 'ameex' | 'sendit' | 'digylog'

export type ConfirmationDeliveryOptions = {
  ozoneCityKey?: number
  ozoneCityName?: string
  ozoneParcelOpen?: 1 | 2
  ozoneParcelFragile?: 0 | 1
  ozoneParcelReplace?: 0 | 1
  forcelogCanOpen?: boolean
  forcelogFragile?: boolean
  forcelogProductNature?: string
  ameexCityKey?: string
  ameexCityName?: string
  ameexParcelType?: 'SIMPLE' | 'STOCK'
  ameexOpen?: boolean
  ameexFragile?: boolean
  ameexReplace?: boolean
  ameexTry?: boolean
  senditCityKey?: string
  senditCityName?: string
  senditAllowOpen?: boolean
  senditAllowTry?: boolean
  senditProductsFromStock?: boolean
  senditPackagingId?: string
  senditOptionExchange?: boolean
  senditDeliveryExchangeId?: string
  senditPickupDistrictId?: string
  digylogNetworkId?: number
  digylogExternalStore?: string
  digylogOrderMode?: 1 | 2
  digylogSendStatus?: 0 | 1
  digylogCheckDuplicate?: 0 | 1
  digylogOpenProduct?: 1 | 2
  digylogPort?: 1 | 2
}

export type DeliveryOptionsErrorCode =
  | 'MISSING_DELIVERY_CITY'
  | 'MISSING_DIGYLOG_NETWORK'
  | 'DIGYLOG_CONFIG_UNAVAILABLE'

const PROVIDER_SLUGS: ConfirmationDeliveryProvider[] = [
  'ozone',
  'forcelog',
  'ameex',
  'sendit',
  'digylog',
]

const PROVIDER_FIELDS: Record<ConfirmationDeliveryProvider, (keyof ConfirmationDeliveryOptions)[]> = {
  ozone: ['ozoneCityKey', 'ozoneCityName', 'ozoneParcelOpen', 'ozoneParcelFragile', 'ozoneParcelReplace'],
  forcelog: ['forcelogCanOpen', 'forcelogFragile', 'forcelogProductNature'],
  ameex: [
    'ameexCityKey',
    'ameexCityName',
    'ameexParcelType',
    'ameexOpen',
    'ameexFragile',
    'ameexReplace',
    'ameexTry',
  ],
  sendit: [
    'senditCityKey',
    'senditCityName',
    'senditAllowOpen',
    'senditAllowTry',
    'senditProductsFromStock',
    'senditPackagingId',
    'senditOptionExchange',
    'senditDeliveryExchangeId',
    'senditPickupDistrictId',
  ],
  digylog: [
    'digylogNetworkId',
    'digylogExternalStore',
    'digylogOrderMode',
    'digylogSendStatus',
    'digylogCheckDuplicate',
    'digylogOpenProduct',
    'digylogPort',
  ],
}


/** Transporteurs qui exigent un choix de ville explicite (comme dans `/sales`). */
const CITY_FIELDS: Partial<
  Record<
    ConfirmationDeliveryProvider,
    { key: keyof ConfirmationDeliveryOptions; name: keyof ConfirmationDeliveryOptions }
  >
> = {
  ozone: { key: 'ozoneCityKey', name: 'ozoneCityName' },
  ameex: { key: 'ameexCityKey', name: 'ameexCityName' },
  sendit: { key: 'senditCityKey', name: 'senditCityName' },
}

export function resolveDeliveryProvider(
  apiProvider: string | null | undefined
): ConfirmationDeliveryProvider | null {
  const slug = String(apiProvider || '').trim().toLowerCase()
  return (PROVIDER_SLUGS as string[]).includes(slug) ? (slug as ConfirmationDeliveryProvider) : null
}

export function deliveryProviderCatalogueId(
  provider: ConfirmationDeliveryProvider | null
): string | null {
  if (provider === 'ozone' || provider === 'ameex' || provider === 'sendit') {
    return DELIVERY_PROVIDER_IDS[provider]
  }
  return null
}

/** Valeurs par défaut alignées sur l'état initial du modal de `/sales`. */
export function createDefaultDeliveryOptions(
  provider: ConfirmationDeliveryProvider | null
): ConfirmationDeliveryOptions {
  switch (provider) {
    case 'ozone':
      return { ozoneParcelOpen: 1, ozoneParcelFragile: 0, ozoneParcelReplace: 0 }
    case 'forcelog':
      return { forcelogCanOpen: true, forcelogFragile: false }
    case 'ameex':
      return {
        ameexParcelType: 'SIMPLE',
        ameexOpen: true,
        ameexFragile: false,
        ameexReplace: true,
        ameexTry: true,
      }
    case 'sendit':
      return {
        senditAllowOpen: true,
        senditAllowTry: true,
        senditProductsFromStock: false,
        senditOptionExchange: false,
      }
    case 'digylog':
      return {
        digylogOrderMode: 1,
        digylogSendStatus: 1,
        digylogCheckDuplicate: 1,
        digylogOpenProduct: 1,
        digylogPort: 2,
      }
    default:
      return {}
  }
}

function toPositiveNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function toPositiveInt(value: unknown) {
  const parsed = toPositiveNumber(value)
  return parsed === undefined ? undefined : Math.trunc(parsed)
}

function toBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true') return true
  if (value === 0 || value === '0' || value === 'false') return false
  return fallback
}

function toText(value: unknown, maxLength = 190) {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, maxLength) : undefined
}

/** Bloque la soumission quand un champ obligatoire du transporteur manque. */
export function validateDeliveryOptions(
  provider: ConfirmationDeliveryProvider | null,
  options: ConfirmationDeliveryOptions | null | undefined
): DeliveryOptionsErrorCode | null {
  if (!provider) return null

  const city = CITY_FIELDS[provider]
  if (city) {
    const cityKey = options ? options[city.key] : undefined
    const cityName = options ? options[city.name] : undefined
    if (!toPositiveNumber(cityKey) || !toText(cityName)) return 'MISSING_DELIVERY_CITY'
  }

  if (provider === 'digylog' && !toPositiveInt(options?.digylogNetworkId)) {
    return 'MISSING_DIGYLOG_NETWORK'
  }

  return null
}

/**
 * Ne conserve que les champs du transporteur retenu, avec des types sûrs.
 * Les booléens `false` et les zéros sont conservés explicitement.
 */
export function sanitizeDeliveryOptions(
  provider: ConfirmationDeliveryProvider | null,
  raw: unknown
): { options: ConfirmationDeliveryOptions; error: DeliveryOptionsErrorCode | null } {
  if (!provider) return { options: {}, error: null }

  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const options: ConfirmationDeliveryOptions = {}

  if (provider === 'ozone') {
    options.ozoneCityKey = toPositiveInt(input.ozoneCityKey)
    options.ozoneCityName = toText(input.ozoneCityName, 120)
    options.ozoneParcelOpen = Number(input.ozoneParcelOpen) === 2 ? 2 : 1
    options.ozoneParcelFragile = Number(input.ozoneParcelFragile) === 1 ? 1 : 0
    options.ozoneParcelReplace = Number(input.ozoneParcelReplace) === 1 ? 1 : 0
  }

  if (provider === 'forcelog') {
    options.forcelogCanOpen = toBoolean(input.forcelogCanOpen, true)
    options.forcelogFragile = toBoolean(input.forcelogFragile, false)
    options.forcelogProductNature = toText(input.forcelogProductNature, 60)
  }

  if (provider === 'ameex') {
    options.ameexCityKey = toText(input.ameexCityKey, 60)
    options.ameexCityName = toText(input.ameexCityName, 120)
    options.ameexParcelType =
      String(input.ameexParcelType || '').toUpperCase() === 'STOCK' ? 'STOCK' : 'SIMPLE'
    options.ameexOpen = toBoolean(input.ameexOpen, true)
    options.ameexFragile = toBoolean(input.ameexFragile, false)
    options.ameexReplace = toBoolean(input.ameexReplace, true)
    options.ameexTry = toBoolean(input.ameexTry, true)
  }

  if (provider === 'sendit') {
    options.senditCityKey = toText(input.senditCityKey, 60)
    options.senditCityName = toText(input.senditCityName, 120)
    options.senditAllowOpen = toBoolean(input.senditAllowOpen, true)
    options.senditAllowTry = toBoolean(input.senditAllowTry, true)
    options.senditProductsFromStock = toBoolean(input.senditProductsFromStock, false)
    options.senditPackagingId = toText(input.senditPackagingId, 60)
    options.senditOptionExchange = toBoolean(input.senditOptionExchange, false)
    options.senditDeliveryExchangeId = toText(input.senditDeliveryExchangeId, 60)
    options.senditPickupDistrictId = toText(input.senditPickupDistrictId, 60)
  }

  if (provider === 'digylog') {
    options.digylogNetworkId = toPositiveInt(input.digylogNetworkId)
    options.digylogExternalStore = toText(input.digylogExternalStore, 60)
    options.digylogOrderMode = Number(input.digylogOrderMode) === 2 ? 2 : 1
    options.digylogSendStatus = Number(input.digylogSendStatus) === 0 ? 0 : 1
    options.digylogCheckDuplicate = toBoolean(input.digylogCheckDuplicate, true) ? 1 : 0
    options.digylogOpenProduct = toBoolean(input.digylogOpenProduct, true) ? 1 : 2
    options.digylogPort = Number(input.digylogPort) === 1 ? 1 : 2
  }

  const cleaned: ConfirmationDeliveryOptions = {}
  for (const key of PROVIDER_FIELDS[provider]) {
    const value = options[key]
    if (value !== undefined) {
      ;(cleaned as Record<string, unknown>)[key] = value
    }
  }

  return { options: cleaned, error: validateDeliveryOptions(provider, cleaned) }
}

/** Clé de ville utilisée pour vérifier le catalogue `delivery_rates` côté serveur. */
export function deliveryCityKeyOf(
  provider: ConfirmationDeliveryProvider | null,
  options: ConfirmationDeliveryOptions
): string | null {
  if (provider === 'ozone') return options.ozoneCityKey ? String(options.ozoneCityKey) : null
  if (provider === 'ameex') return options.ameexCityKey || null
  if (provider === 'sendit') return options.senditCityKey || null
  return null
}

