// ============================================================
// Client API OZONE Express (ozoneexpress.ma)
// Auth: customer_id + api_key dans l'URL
// Payload: form-data (multipart)
// ============================================================

const OZONE_API_BASE_URL = 'https://client.ozoneexpress.ma/api/v1'

export type OzoneConfig = {
  customerId: string
  apiKey: string
}

export type OzoneCity = {
  id: number
  city: string
}

export type OzoneParcelPayload = {
  'parcel-name': string
  'parcel-phone': string
  'parcel-city': number
  'parcel-price': number
  'parcel-address': string
  'parcel-receiver-name': string
  'parcel-stock': 0 | 1
  'parcel-declared-value'?: number
  'parcel-remark'?: string
}

export type OzoneParcelResponse = {
  success: boolean
  message: string
  data?: {
    id: number
    ref: string
    tracking: string
  }
}

export type OzoneTrackingItem = {
  id: number
  ref: string
  tracking: string
  status: string
  status_date: string
  city: string
  client_name: string
  phone: string
  price: number
  declared_value: number
  address: string
  note: string
  stock: string
}

export type OzoneTrackingResponse = {
  success: boolean
  message: string
  data?: OzoneTrackingItem | OzoneTrackingItem[]
}

export type OzoneDeliveryNotePayload = {
  'dn-date': string
  'dn-remark'?: string
}

export type OzoneDeliveryNoteResponse = {
  success: boolean
  message: string
  data?: {
    id: number
    ref: string
  }
}

export type OzoneAddParcelToDnPayload = {
  'dn-ref': string
  'parcels-refs': string
}

export type OzoneSaveDnResponse = {
  success: boolean
  message: string
  data?: {
    id: number
    ref: string
    status: string
  }
}

function buildUrl(config: OzoneConfig, path: string): string {
  return `${OZONE_API_BASE_URL}/customers/${encodeURIComponent(config.customerId)}/${encodeURIComponent(config.apiKey)}${path}`
}

function toFormData(payload: Record<string, string | number | undefined>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== null) {
      fd.append(key, String(value))
    }
  }
  return fd
}

async function ozoneFetch<T>(url: string, formData?: FormData): Promise<T> {
  const response = await fetch(url, {
    method: formData ? 'POST' : 'GET',
    ...(formData ? { body: formData } : {}),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`OZONE_API_ERROR:${response.status}:${text}`)
  }

  return response.json() as Promise<T>
}

/**
 * Récupère la liste des villes OZONE
 * GET /cities
 */
export async function listOzoneCities(): Promise<OzoneCity[]> {
  const response = await fetch(`${OZONE_API_BASE_URL}/cities`)
  if (!response.ok) {
    throw new Error(`OZONE_CITIES_ERROR:${response.status}`)
  }
  return response.json() as Promise<OzoneCity[]>
}

/**
 * Crée un colis chez OZONE
 * POST /customers/{id}/{key}/add-parcel (form-data)
 */
export async function createOzoneParcel(config: OzoneConfig, payload: OzoneParcelPayload): Promise<OzoneParcelResponse> {
  const url = buildUrl(config, '/add-parcel')
  const fd = toFormData(payload as Record<string, string | number | undefined>)
  return ozoneFetch<OzoneParcelResponse>(url, fd)
}

/**
 * Récupère les infos d'un colis
 * POST /customers/{id}/{key}/parcel-info (form-data)
 */
export async function getOzoneParcelInfo(config: OzoneConfig, parcelRef: string): Promise<OzoneTrackingResponse> {
  const url = buildUrl(config, '/parcel-info')
  const fd = toFormData({ 'parcel-ref': parcelRef })
  return ozoneFetch<OzoneTrackingResponse>(url, fd)
}

/**
 * Track un ou plusieurs colis
 * POST /customers/{id}/{key}/tracking
 * Supporte: single ref (form-data) ou bulk (JSON body)
 */
export async function trackOzoneParcel(config: OzoneConfig, parcelRef: string): Promise<OzoneTrackingResponse> {
  const url = buildUrl(config, '/tracking')
  const fd = toFormData({ 'parcel-ref': parcelRef })
  return ozoneFetch<OzoneTrackingResponse>(url, fd)
}

/**
 * Track multiple colis en bulk (JSON)
 * POST /customers/{id}/{key}/tracking
 */
export async function trackOzoneParcelsBulk(config: OzoneConfig, refs: string[]): Promise<OzoneTrackingResponse> {
  const url = buildUrl(config, '/tracking')
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refs }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`OZONE_BULK_TRACK_ERROR:${response.status}:${text}`)
  }
  return response.json() as Promise<OzoneTrackingResponse>
}

/**
 * Crée un bon de livraison (BL)
 * POST /customers/{id}/{key}/add-delivery-note (form-data)
 */
export async function createOzoneDeliveryNote(config: OzoneConfig, payload: OzoneDeliveryNotePayload): Promise<OzoneDeliveryNoteResponse> {
  const url = buildUrl(config, '/add-delivery-note')
  const fd = toFormData(payload as Record<string, string | number | undefined>)
  return ozoneFetch<OzoneDeliveryNoteResponse>(url, fd)
}

/**
 * Ajoute des colis à un BL existant
 * POST /customers/{id}/{key}/add-parcel-to-delivery-note (form-data)
 */
export async function addParcelsToOzoneDeliveryNote(config: OzoneConfig, payload: OzoneAddParcelToDnPayload): Promise<OzoneDeliveryNoteResponse> {
  const url = buildUrl(config, '/add-parcel-to-delivery-note')
  const fd = toFormData(payload as Record<string, string | number | undefined>)
  return ozoneFetch<OzoneDeliveryNoteResponse>(url, fd)
}

/**
 * Sauvegarde et finalise un BL
 * POST /customers/{id}/{key}/save-delivery-note (form-data)
 */
export async function saveOzoneDeliveryNote(config: OzoneConfig, dnRef: string): Promise<OzoneSaveDnResponse> {
  const url = buildUrl(config, '/save-delivery-note')
  const fd = toFormData({ 'dn-ref': dnRef })
  return ozoneFetch<OzoneSaveDnResponse>(url, fd)
}

/**
 * URL du PDF d'un BL
 */
export function getOzoneDeliveryNotePdfUrl(dnRef: string): string {
  return `https://client.ozoneexpress.ma/pdf-delivery-note?dn-ref=${encodeURIComponent(dnRef)}`
}

/**
 * Normalise le téléphone pour OZONE (supprime les espaces)
 */
export function normalizeOzonePhone(value: string): string {
  return String(value || '').replace(/\s+/g, '').trim()
}

/**
 * Détermine si declared-value est requis (price > 5000 MAD)
 */
export function isOzoneDeclaredValueRequired(price: number): boolean {
  return price > 5000
}
