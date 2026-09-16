import { normalizeMoroccanPhone } from '@/lib/utils'

const MAROC_GO_DELIVERY_API_BASE_URL = 'https://www.marocgodelivery.com/api/v1'

type MarocGoDeliveryRequestInit = {
  token: string
  method?: 'GET' | 'POST'
  path: string
  body?: Record<string, unknown>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function marocGoDeliveryFetch<T>(params: MarocGoDeliveryRequestInit): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${MAROC_GO_DELIVERY_API_BASE_URL}${params.path}`, {
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
    console.error('Maroc Go Delivery API error', {
      path: params.path,
      method: params.method || 'GET',
      status: response.status,
      body: message,
    })
    if (response.status === 401 || response.status === 403) {
      throw new Error('Token API Maroc Go Delivery invalide ou expiré.')
    }

    if (response.status >= 500) {
      if (attempt < 2) {
        await sleep(400 * (attempt + 1))
        continue
      }
      throw new Error('Serveur Maroc Go Delivery indisponible. Réessayez plus tard.')
    }

    throw new Error(message || `Erreur API Maroc Go Delivery (${response.status}).`)
  }

  throw new Error('MAROC_GO_DELIVERY_REQUEST_FAILED')
}

export type MarocGoDeliveryShop = {
  key: number
  name: string
  phone?: string
  allow_opening_parcels: boolean
}

export type MarocGoDeliveryCity = {
  key: number
  city_name: string
  cost_delivery: number
  cost_refuse: number
  cost_cancel: number
}

export type MarocGoDeliveryState = {
  key: number
  state_name: string
}

export type MarocGoDeliveryTrackingPayload = {
  key?: string | number
  state?: {
    state_name?: string | null
    key?: string | number | null
  } | null
  [key: string]: unknown
}

export type MarocGoDeliveryMappedOrderStatus = {
  orderStatus: string | null
  deliveryStatus: string
  statusDateField: string | null
  rawStatus: string
}

function extractMarocGoDeliveryPayloadItem(payload: MarocGoDeliveryTrackingPayload | unknown) {
  if (Array.isArray(payload)) return payload[0] as Record<string, unknown> | undefined
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (Array.isArray(record.data)) return (record.data[0] || null) as Record<string, unknown> | undefined
    if (Array.isArray(record.Data)) return (record.Data[0] || null) as Record<string, unknown> | undefined
    return record
  }
  return undefined
}

export function getMarocGoDeliveryStateName(payload: MarocGoDeliveryTrackingPayload | unknown) {
  const item = extractMarocGoDeliveryPayloadItem(payload)
  const state = item?.state as Record<string, unknown> | undefined
  const upperState = item?.State as Record<string, unknown> | undefined
  return String(state?.state_name || upperState?.state_name || '').trim()
}

const MAROC_GO_DELIVERY_STATUS_MAP: Array<{
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

function normalizeMarocGoDeliveryStatusName(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function mapMarocGoDeliveryStateToOrderStatus(stateName: string): MarocGoDeliveryMappedOrderStatus {
  const rawStatus = String(stateName || '').trim()
  const normalized = normalizeMarocGoDeliveryStatusName(rawStatus)

  if (normalized.includes('retour')) {
    return {
      orderStatus: 'returned_not_stocked',
      deliveryStatus: 'returned',
      statusDateField: 'returned_not_stocked_at',
      rawStatus,
    }
  }

  const match = MAROC_GO_DELIVERY_STATUS_MAP.find((item) => item.matches.some((candidate) => normalized.includes(candidate)))
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

export type MarocGoDeliveryParcelPayload = {
  article: string
  price: number
  phone: string
  city: number
  shop: number
  address?: string
  recipient?: string
  remark?: string
}

export function normalizeMarocGoDeliveryPhone(value: string) {
  return normalizeMoroccanPhone(value)
}

export async function listMarocGoDeliveryShops(token: string) {
  return marocGoDeliveryFetch<MarocGoDeliveryShop[]>({ token, path: '/shops' })
}

export async function listMarocGoDeliveryCities(token: string) {
  return marocGoDeliveryFetch<MarocGoDeliveryCity[]>({ token, path: '/cities' })
}

export async function listMarocGoDeliveryStates(token: string) {
  return marocGoDeliveryFetch<MarocGoDeliveryState[]>({ token, path: '/states' })
}

export async function createMarocGoDeliveryParcel(token: string, payload: MarocGoDeliveryParcelPayload) {
  return marocGoDeliveryFetch<{ message: string; data: { key: string } }>({
    token,
    path: '/parcels',
    method: 'POST',
    body: payload,
  })
}

export async function trackMarocGoDeliveryParcel(token: string, trackingNumber: string) {
  return marocGoDeliveryFetch<MarocGoDeliveryTrackingPayload>({ token, path: `/parcels/${encodeURIComponent(trackingNumber)}` })
}

export async function createMarocGoDeliveryVoucher(token: string, payload: { shop: number; parcels: Array<string | number> }) {
  return marocGoDeliveryFetch<{ message: string; data: { key: string } }>({
    token,
    path: '/vouchers',
    method: 'POST',
    body: payload,
  })
}

export async function getMarocGoDeliveryVoucher(token: string, key: string) {
  return marocGoDeliveryFetch<any>({ token, path: `/vouchers/${encodeURIComponent(key)}` })
}

export async function downloadMarocGoDeliveryHtml(token: string, path: string) {
  const response = await fetch(`${MAROC_GO_DELIVERY_API_BASE_URL}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'text/html,application/json',
    },
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`MAROC_GO_DELIVERY_DOWNLOAD_ERROR:${response.status}:${message}`)
  }

  return response.text()
}

