const RAPID_DELIVERY_API_BASE_URL = 'https://www.rapiddelivery.ma/api/v1'

type RapidDeliveryRequestInit = {
  token: string
  method?: 'GET' | 'POST'
  path: string
  body?: Record<string, unknown>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function rapidDeliveryFetch<T>(params: RapidDeliveryRequestInit): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${RAPID_DELIVERY_API_BASE_URL}${params.path}`, {
      method: params.method || 'GET',
      headers: {
        Authorization: `Bearer ${params.token}`,
        Accept: 'application/json',
        ...(params.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: params.body ? JSON.stringify(params.body) : undefined,
    })

    if (response.ok) {
      return response.json() as Promise<T>
    }

    const message = await response.text()
    console.error('Rapid Delivery API error', {
      path: params.path,
      method: params.method || 'GET',
      status: response.status,
      body: message,
    })
    if (response.status === 401 || response.status === 403) {
      throw new Error('Token API Rapid Delivery invalide ou expiré.')
    }

    if (response.status >= 500) {
      if (attempt < 2) {
        await sleep(400 * (attempt + 1))
        continue
      }
      throw new Error('Serveur Rapid Delivery indisponible. Réessayez plus tard.')
    }

    throw new Error(message || `Erreur API Rapid Delivery (${response.status}).`)
  }

  throw new Error('RAPID_DELIVERY_REQUEST_FAILED')
}

export type RapidDeliveryShop = {
  key: number
  name: string
  phone?: string
  allow_opening_parcels: boolean
}

export type RapidDeliveryCity = {
  key: number
  city_name: string
  cost_delivery: number
  cost_refuse: number
  cost_cancel: number
}

export type RapidDeliveryState = {
  key: number
  state_name: string
}

export type RapidDeliveryTrackingPayload = {
  key?: string | number
  state?: {
    state_name?: string | null
    key?: string | number | null
  } | null
  [key: string]: unknown
}

export type RapidDeliveryMappedOrderStatus = {
  orderStatus: string | null
  deliveryStatus: string
  statusDateField: string | null
  rawStatus: string
}

function extractRapidDeliveryPayloadItem(payload: RapidDeliveryTrackingPayload | unknown) {
  if (Array.isArray(payload)) return payload[0] as Record<string, unknown> | undefined
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (Array.isArray(record.data)) return (record.data[0] || null) as Record<string, unknown> | undefined
    if (Array.isArray(record.Data)) return (record.Data[0] || null) as Record<string, unknown> | undefined
    return record
  }
  return undefined
}

export function getRapidDeliveryStateName(payload: RapidDeliveryTrackingPayload | unknown) {
  const item = extractRapidDeliveryPayloadItem(payload)
  const state = item?.state as Record<string, unknown> | undefined
  const upperState = item?.State as Record<string, unknown> | undefined
  return String(state?.state_name || upperState?.state_name || '').trim()
}

const RAPID_DELIVERY_STATUS_MAP: Array<{
  matches: string[]
  orderStatus: string
  deliveryStatus: string
  statusDateField: string
}> = [
  { matches: ['expediee', 'expedie'], orderStatus: 'sent', deliveryStatus: 'in_transit', statusDateField: 'sent_at' },
  { matches: ['pas de reponse'], orderStatus: 'dl_no_answer', deliveryStatus: 'pending', statusDateField: 'dl_no_answer_at' },
  { matches: ['injoignable'], orderStatus: 'dl_unreachable', deliveryStatus: 'pending', statusDateField: 'dl_unreachable_at' },
  { matches: ['hors zone'], orderStatus: 'dl_out_of_zone', deliveryStatus: 'pending', statusDateField: 'dl_out_of_zone_at' },
  { matches: ['client interesse'], orderStatus: 'dl_client_interested', deliveryStatus: 'pending', statusDateField: 'dl_client_interested_at' },
  { matches: ['reportee', 'reporte'], orderStatus: 'dl_postponed', deliveryStatus: 'pending', statusDateField: 'dl_postponed_at' },
  { matches: ["changement d adresse", 'changement adresse'], orderStatus: 'dl_address_change', deliveryStatus: 'pending', statusDateField: 'dl_address_change_at' },
  { matches: ['livree', 'livre'], orderStatus: 'delivered', deliveryStatus: 'delivered', statusDateField: 'delivered_at' },
  { matches: ['refusee', 'refuse'], orderStatus: 'refused', deliveryStatus: 'refused', statusDateField: 'refused_at' },
  { matches: ['annulee par client', 'annule par client'], orderStatus: 'cancelled', deliveryStatus: 'cancelled', statusDateField: 'cancelled_at' },
  { matches: ['annulee', 'annule'], orderStatus: 'cancelled', deliveryStatus: 'cancelled', statusDateField: 'cancelled_at' },
  { matches: ['en attente de ramassage'], orderStatus: 'dl_pickup_pending', deliveryStatus: 'pickup_pending', statusDateField: 'dl_pickup_pending_at' },
  { matches: ['ramassee', 'ramasse'], orderStatus: 'picked_up', deliveryStatus: 'picked_up', statusDateField: 'picked_up_at' },
  { matches: ['remboursement'], orderStatus: 'dl_refund', deliveryStatus: 'cancelled', statusDateField: 'dl_refund_at' },
  { matches: ['demande de suivie'], orderStatus: 'dl_follow_up_request', deliveryStatus: 'pending', statusDateField: 'dl_follow_up_request_at' },
  { matches: ['facture par erreur'], orderStatus: 'dl_billing_error', deliveryStatus: 'cancelled', statusDateField: 'dl_billing_error_at' },
  { matches: ['sortie pour livraison'], orderStatus: 'dl_out_for_delivery', deliveryStatus: 'in_transit', statusDateField: 'dl_out_for_delivery_at' },
]

function normalizeRapidDeliveryStatusName(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function mapRapidDeliveryStateToOrderStatus(stateName: string): RapidDeliveryMappedOrderStatus {
  const rawStatus = String(stateName || '').trim()
  const normalized = normalizeRapidDeliveryStatusName(rawStatus)

  if (normalized.includes('retour')) {
    return {
      orderStatus: 'returned_not_stocked',
      deliveryStatus: 'returned',
      statusDateField: 'returned_not_stocked_at',
      rawStatus,
    }
  }

  const match = RAPID_DELIVERY_STATUS_MAP.find((item) => item.matches.some((candidate) => normalized.includes(candidate)))
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

export type RapidDeliveryParcelPayload = {
  article: string
  price: number
  phone: string
  city: number
  shop: number
  address?: string
  recipient?: string
  remark?: string
}

export function normalizeRapidDeliveryPhone(value: string) {
  return String(value || '').replace(/\s+/g, '').trim()
}

export async function listRapidDeliveryShops(token: string) {
  return rapidDeliveryFetch<RapidDeliveryShop[]>({ token, path: '/shops' })
}

export async function listRapidDeliveryCities(token: string) {
  return rapidDeliveryFetch<RapidDeliveryCity[]>({ token, path: '/cities' })
}

export async function listRapidDeliveryStates(token: string) {
  return rapidDeliveryFetch<RapidDeliveryState[]>({ token, path: '/states' })
}

export async function createRapidDeliveryParcel(token: string, payload: RapidDeliveryParcelPayload) {
  return rapidDeliveryFetch<{ message: string; data: { key: string } }>({
    token,
    path: '/parcels',
    method: 'POST',
    body: payload,
  })
}

export async function trackRapidDeliveryParcel(token: string, trackingNumber: string) {
  return rapidDeliveryFetch<RapidDeliveryTrackingPayload>({ token, path: `/parcels/${encodeURIComponent(trackingNumber)}` })
}

export async function createRapidDeliveryVoucher(token: string, payload: { shop: number; parcels: Array<string | number> }) {
  return rapidDeliveryFetch<{ message: string; data: { key: string } }>({
    token,
    path: '/vouchers',
    method: 'POST',
    body: payload,
  })
}

export async function getRapidDeliveryVoucher(token: string, key: string) {
  return rapidDeliveryFetch<any>({ token, path: `/vouchers/${encodeURIComponent(key)}` })
}

export async function downloadRapidDeliveryHtml(token: string, path: string) {
  const response = await fetch(`${RAPID_DELIVERY_API_BASE_URL}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'text/html,application/json',
    },
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`RAPID_DELIVERY_DOWNLOAD_ERROR:${response.status}:${message}`)
  }

  return response.text()
}