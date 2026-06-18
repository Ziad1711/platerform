// ============================================================
// Client API ForceLog (forcelog.ma)
// Auth: X-API-Key header
// ============================================================

const FORCELOG_API_BASE_URL = 'https://api.forcelog.ma'

export type ForceLogParcelPayload = {
  ORDER_NUM: string
  RECEIVER: string
  PHONE: string
  CITY: string
  ADDRESS: string
  COMMENT?: string
  PRODUCT_NATURE?: string
  COD?: number
  CAN_OPEN?: boolean
  FRAGILE?: boolean
  CARTON?: string
  STOCK?: string
}

export type ForceLogParcelResponse = {
  'ADD-PARCEL'?: {
    RESULT: 'SUCCESS' | 'ERROR'
    MESSAGE: string
    'NEW-PARCEL'?: {
      TRACKING_NUMBER: string
      ORDER_NUM: string
      RECEIVER: string
      PHONE: string
      CITY_NAME: string
      ADDRESS: string
      PRICE: string
      COMMENT: string
      PRODUCT_NATURE: string
    }
  }
}

export type ForceLogTrackingResponse = {
  RESULT: 'SUCCESS' | 'ERROR'
  MESSAGE?: string
  PARCEL?: {
    TRACKING_NUMBER: string
    ORDER_NUM: string
    RECEIVER: string
    PHONE: string
    CITY_NAME: string
    ADDRESS: string
    PRICE: string
    COMMENT: string
    PRODUCT_NATURE: string
    CAN_OPEN: string
    CREATION_TIME: string
    STATUS: string
    SITUATION: string
    DELIVERY_FEES: number
  }
}

export type ForceLogPickupPayload = {
  PHONE: string
  CITY: string
  ADDRESS: string
  COMMENT?: string
  STICKERS?: boolean
}

export type ForceLogPickupResponse = {
  'ADD-PICKUP'?: {
    RESULT: 'SUCCESS' | 'ERROR'
    MESSAGE: string
  }
}

export type ForceLogHealthResponse = {
  AUTH?: {
    RESULT: 'SUCCESS' | 'ERROR'
    MESSAGE: string
  }
}

function truncate(value: string, max: number): string {
  return String(value || '').slice(0, max)
}

export function normalizeForceLogPhone(value: string): string {
  return String(value || '').replace(/\s+/g, '').trim()
}

async function forcelogFetch<T>(apiKey: string, path: string, options?: { method?: 'GET' | 'POST'; body?: Record<string, unknown> }): Promise<T> {
  const url = `${FORCELOG_API_BASE_URL}${path}${options?.method === 'GET' && options?.body ? '?' + new URLSearchParams(options.body as Record<string, string>).toString() : ''}`
  
  const response = await fetch(url, {
    method: options?.method || 'GET',
    headers: {
      'X-API-Key': apiKey,
      ...(options?.body && options?.method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options?.body && options?.method !== 'GET' ? { body: JSON.stringify(options.body) } : {}),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`FORCELOG_API_ERROR:${response.status}:${text}`)
  }

  return response.json() as Promise<T>
}

export async function validateForceLogApiKey(apiKey: string): Promise<boolean> {
  try {
    const url = `${FORCELOG_API_BASE_URL}/health`
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'X-API-Key': apiKey },
    })
    return response.ok
  } catch {
    return false
  }
}

export async function createForceLogParcel(apiKey: string, payload: ForceLogParcelPayload): Promise<ForceLogParcelResponse> {
  return forcelogFetch<ForceLogParcelResponse>(apiKey, '/customer/Parcels/AddParcel', {
    method: 'POST',
    body: payload as unknown as Record<string, unknown>,
  })
}

export async function trackForceLogParcel(apiKey: string, code: string): Promise<ForceLogTrackingResponse> {
  return forcelogFetch<ForceLogTrackingResponse>(apiKey, `/customer/Parcels/GetParcel?Code=${encodeURIComponent(code)}`)
}

export async function createForceLogPickupRequest(apiKey: string, payload: ForceLogPickupPayload): Promise<ForceLogPickupResponse> {
  return forcelogFetch<ForceLogPickupResponse>(apiKey, '/customer/Pickups/CreateRequest', {
    method: 'POST',
    body: payload as unknown as Record<string, unknown>,
  })
}

export async function downloadForceLogSticker(apiKey: string, parcelCode: string): Promise<ArrayBuffer> {
  const url = `${FORCELOG_API_BASE_URL}/customer/PDF/ParcelSticker?parcelCode=${encodeURIComponent(parcelCode)}`
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'X-API-Key': apiKey },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`FORCELOG_STICKER_ERROR:${response.status}:${text}`)
  }

  return response.arrayBuffer()
}

export const FORCELOG_STATUS_MAP: Array<{
  matches: string[]
  orderStatus: string | null
  deliveryStatus: string
  statusDateField: string | null
}> = [
  { matches: ['livre', 'delivered', 'livree'], orderStatus: 'delivered', deliveryStatus: 'delivered', statusDateField: 'delivered_at' },
  { matches: ['refuse', 'refused', 'refusee'], orderStatus: 'refused', deliveryStatus: 'refused', statusDateField: 'refused_at' },
  { matches: ['annule', 'cancelled', 'annulee'], orderStatus: 'cancelled', deliveryStatus: 'cancelled', statusDateField: 'cancelled_at' },
  { matches: ['retour', 'returned'], orderStatus: 'returned_not_stocked', deliveryStatus: 'returned', statusDateField: 'returned_not_stocked_at' },
  { matches: ['rembourse'], orderStatus: 'dl_refund', deliveryStatus: 'returned', statusDateField: 'dl_refund_at' },
  { matches: ['ramasse', 'saisi', 'picked up', 'ramassee'], orderStatus: 'picked_up', deliveryStatus: 'picked_up', statusDateField: 'picked_up_at' },
  { matches: ['expedie', 'envoye', 'en cours', 'sent', 'shipped'], orderStatus: 'sent', deliveryStatus: 'in_transit', statusDateField: 'sent_at' },
  { matches: ['pas de reponse', 'no answer'], orderStatus: 'dl_no_answer', deliveryStatus: 'in_transit', statusDateField: 'dl_no_answer_at' },
  { matches: ['injoignable', 'unreachable'], orderStatus: 'dl_unreachable', deliveryStatus: 'in_transit', statusDateField: 'dl_unreachable_at' },
  { matches: ['hors zone', 'out of zone'], orderStatus: 'dl_out_of_zone', deliveryStatus: 'returned', statusDateField: 'dl_out_of_zone_at' },
  { matches: ['en attente', 'pending', 'cree', 'created'], orderStatus: null, deliveryStatus: 'pending', statusDateField: null },
]

function normalizeForceLogStatusName(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function mapForceLogStatusToOrderStatus(rawStatus: string) {
  const normalized = normalizeForceLogStatusName(rawStatus)

  const match = FORCELOG_STATUS_MAP.find((item) =>
    item.matches.some((candidate) => normalized.includes(candidate))
  )

  if (match) {
    return {
      rawStatus,
      orderStatus: match.orderStatus,
      deliveryStatus: match.deliveryStatus,
      statusDateField: match.statusDateField,
    }
  }

  return {
    rawStatus,
    orderStatus: null,
    deliveryStatus: 'pending',
    statusDateField: null,
  }
}