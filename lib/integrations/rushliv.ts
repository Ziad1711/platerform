// ============================================================
// Client API Rushliv
// Documentation : GET /api-cities, POST /api-parcels (action=add|track)
// Aucun endpoint shops / vouchers / labels / webhooks n'est documenté.
// ============================================================

import { normalizeMoroccanPhone } from '@/lib/utils'

const RUSHLIV_API_BASE_URL = 'https://clients.rushliv.com'

export type RushlivCity = {
  id: number
  code: string
  name: string
  active: number
}

export type RushlivTrackingEvent = {
  code?: string | null
  etat?: string | null
  status?: string | null
  time?: string | null
}

export type RushlivTrackingPayload = {
  status?: boolean | number
  tracking?: string
  msg?: RushlivTrackingEvent[] | string
  delivery?: { phone?: string | null; name?: string | null } | null
  [key: string]: unknown
}

export type RushlivAddParcelResponse = {
  status?: number | string | boolean
  msg?: string
  tracking?: string
}

export type RushlivMappedOrderStatus = {
  orderStatus: string | null
  deliveryStatus: string
  statusDateField: string | null
  rawStatus: string
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function rushlivFetch<T>(params: {
  token: string
  path: string
  method?: 'GET' | 'POST'
  form?: Record<string, string | number | undefined | null>
}): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const isPost = (params.method || 'GET') === 'POST'
    const form = new URLSearchParams()
    if (isPost) {
      form.append('token', params.token)
      for (const [key, value] of Object.entries(params.form || {})) {
        if (value === undefined || value === null || value === '') continue
        form.append(key, String(value))
      }
    }

    const response = await fetch(`${RUSHLIV_API_BASE_URL}${params.path}`, {
      method: params.method || 'GET',
      headers: {
        Accept: 'application/json',
        ...(isPost ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: isPost ? form.toString() : undefined,
      cache: 'no-store',
    })

    if (response.ok) {
      const payload = (await response.json()) as T
      // Rushliv renvoie HTTP 200 avec un `status` interne en cas d'erreur
      // (401/403 = token invalide ou non autorisé).
      const apiStatus = Number((payload as { status?: unknown })?.status)
      if (apiStatus === 401 || apiStatus === 403) {
        throw new Error(
          String((payload as { msg?: unknown })?.msg || 'Token API Rushliv invalide ou expiré.')
        )
      }
      return payload
    }

    const message = await response.text()
    console.error('Rushliv API error', {
      path: params.path,
      method: params.method || 'GET',
      status: response.status,
      body: message,
    })

    if (response.status === 401 || response.status === 403) {
      throw new Error('Token API Rushliv invalide ou expiré.')
    }

    if (response.status >= 500) {
      if (attempt < 2) {
        await sleep(400 * (attempt + 1))
        continue
      }
      throw new Error('Serveur Rushliv indisponible. Réessayez plus tard.')
    }

    throw new Error(message || `Erreur API Rushliv (${response.status}).`)
  }

  throw new Error('RUSHLIV_REQUEST_FAILED')
}

export async function listRushlivCities(): Promise<RushlivCity[]> {
  const payload = await rushlivFetch<{ status?: number; cities?: RushlivCity[] }>({
    token: '',
    path: '/api-cities',
  })

  const cities = Array.isArray(payload?.cities) ? payload.cities : []
  return cities.filter((city) => Number(city?.active ?? 1) === 1 && city?.name)
}

export function normalizeRushlivPhone(value: string) {
  return normalizeMoroccanPhone(value)
}

export async function createRushlivParcel(token: string, payload: {
  tracking?: string
  name: string
  phone: string
  product: string
  qty?: number
  ville: string
  villeType?: 'name' | 'code'
  adresse?: string
  note?: string
  stock?: 0 | 1
  openPackage?: 0 | 1
  parcelReplace?: 0 | 1
  price: number
  user?: string
}): Promise<RushlivAddParcelResponse> {
  const raw = await rushlivFetch<RushlivAddParcelResponse>({
    token,
    path: '/api-parcels',
    method: 'POST',
    form: {
      action: 'add',
      tracking: payload.tracking,
      name: payload.name,
      phone: payload.phone,
      product: payload.product,
      qty: payload.qty ?? 1,
      ville: payload.ville,
      ville_type: payload.villeType || 'name',
      adresse: payload.adresse,
      note: payload.note,
      stock: payload.stock ?? 0,
      open_package: payload.openPackage ?? 0,
      parcel_replace: payload.parcelReplace ?? 0,
      price: payload.price,
      user: payload.user,
    },
  })

  const status = Number(raw?.status ?? 0)
  if (status !== 200 || !raw?.tracking) {
    throw new Error(String(raw?.msg || `Erreur création colis Rushliv (${status || 'inconnu'}).`))
  }

  return raw
}

export async function trackRushlivParcel(token: string, tracking: string): Promise<RushlivTrackingPayload> {
  const raw = await rushlivFetch<RushlivTrackingPayload>({
    token,
    path: '/api-parcels',
    method: 'POST',
    form: { action: 'track', tracking },
  })

  const status = raw?.status
  if (status === false || status === 0) {
    throw new Error(String((raw as { msg?: string })?.msg || 'Colis Rushliv introuvable.'))
  }

  return raw
}

/**
 * Vérifie qu'un token API Rushliv est valide.
 *
 * `/api-cities` étant public, la validation passe par `action=track` avec un
 * numéro inexistant : un token valide répond `status: false` (« colis
 * introuvable »), un token invalide déclenche l'erreur 401/403 gérée par
 * `rushlivFetch`.
 */
export async function validateRushlivToken(token: string) {
  const trimmed = String(token || '').trim()
  if (!trimmed) throw new Error('MISSING_API_TOKEN')

  await rushlivFetch<RushlivTrackingPayload>({
    token: trimmed,
    path: '/api-parcels',
    method: 'POST',
    form: { action: 'track', tracking: 'RUSHLIV-TOKEN-CHECK' },
  })

  return true
}

export function getRushlivTrackingEvent(payload: RushlivTrackingPayload | unknown): RushlivTrackingEvent | null {
  const record = (payload && typeof payload === 'object' ? payload : {}) as RushlivTrackingPayload
  const events = Array.isArray(record.msg) ? record.msg : []
  if (events.length === 0) return null
  return events[events.length - 1] || null
}

/** Statut brut : « status » et « etat » du dernier évènement. */
export function getRushlivStateName(payload: RushlivTrackingPayload | unknown) {
  const event = getRushlivTrackingEvent(payload)
  const status = String(event?.status || '').trim()
  const etat = String(event?.etat || '').trim()
  return [status, etat].filter(Boolean).join(' ')
}


const RUSHLIV_STATUS_MAP: Array<{
  matches: string[]
  orderStatus: string | null
  deliveryStatus: string
  statusDateField: string | null
}> = [
  { matches: ['livree', 'livre', 'recu', 'recue', 'delivered'], orderStatus: 'delivered', deliveryStatus: 'delivered', statusDateField: 'delivered_at' },
  { matches: ['retour'], orderStatus: 'returned_not_stocked', deliveryStatus: 'returned', statusDateField: 'returned_not_stocked_at' },
  { matches: ['refus'], orderStatus: 'refused', deliveryStatus: 'refused', statusDateField: 'refused_at' },
  { matches: ['annul'], orderStatus: 'cancelled', deliveryStatus: 'cancelled', statusDateField: 'cancelled_at' },
  { matches: ['cours de livraison', 'en livraison', 'sorti en livraison'], orderStatus: 'dl_out_for_delivery', deliveryStatus: 'in_transit', statusDateField: 'dl_out_for_delivery_at' },
  { matches: ['ramass', 'collect', 'expedi', 'transit', 'en cours', 'shipping'], orderStatus: 'sent', deliveryStatus: 'in_transit', statusDateField: 'sent_at' },
]

function normalizeRushlivStatusName(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/livreur/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Convertit un statut Rushliv en statut interne. Les états non reconnus
 * renvoient orderStatus = null afin de préserver le statut interne existant.
 */
export function mapRushlivStateToOrderStatus(stateName: string): RushlivMappedOrderStatus {
  const rawStatus = String(stateName || '').trim()
  const normalized = normalizeRushlivStatusName(rawStatus)

  const match = RUSHLIV_STATUS_MAP.find((item) => item.matches.some((candidate) => normalized.includes(candidate)))
  if (match) {
    return {
      orderStatus: match.orderStatus,
      deliveryStatus: match.deliveryStatus,
      statusDateField: match.statusDateField,
      rawStatus,
    }
  }

  return {
    orderStatus: null,
    deliveryStatus: 'pending',
    statusDateField: null,
    rawStatus,
  }
}

