// ============================================================
// Client API OZONE Express (ozoneexpress.ma)
// Auth: customer_id + api_key dans l'URL
// Payload: form-data (multipart)
// ============================================================

const OZONE_API_BASE_URL = 'https://api.ozonexpress.ma'

export type OzoneConfig = {
  customerId: string
  apiKey: string
}

export type OzoneCity = {
  id: number
  city: string
}

export type OzoneParcelPayload = {
  'parcel-nature'?: string
  'parcel-phone': string
  'parcel-city': number
  'parcel-price': number
  'parcel-address': string
  'parcel-receiver': string
  'parcel-stock': 0 | 1
  'parcel-declared-value'?: number
  'parcel-note'?: string
  'parcel-open'?: 1 | 2
  'parcel-fragile'?: 0 | 1
  'parcel-replace'?: 0 | 1
}

export type OzoneParcelResponse = {
  success: boolean
  message: string
  'TRACKING-NUMBER'?: string
  'TRACKING_NUMBER'?: string
  TRACKING?: string
  REF?: string
  ref?: string
  tracking?: string
  data?: {
    id: number
    ref: string
    tracking: string
    'TRACKING-NUMBER'?: string
  }
  'ADD-PARCEL'?: {
    RESULT?: string
    MESSAGE?: string
    'NEW-PARCEL'?: Record<string, unknown>
  }
}

export function extractOzoneTrackingNumber(response: unknown): string {
  const payload = response as any
  const newParcel = payload?.['ADD-PARCEL']?.['NEW-PARCEL']
  const candidates = [
    newParcel?.['TRACKING-NUMBER'],
    newParcel?.TRACKING_NUMBER,
    newParcel?.TRACKING,
    newParcel?.tracking,
    newParcel?.ref,
    payload?.['TRACKING-NUMBER'],
    payload?.TRACKING_NUMBER,
    payload?.TRACKING,
    payload?.tracking,
    payload?.data?.['TRACKING-NUMBER'],
    payload?.data?.tracking,
    payload?.data?.ref,
    payload?.REF,
    payload?.ref,
  ]

  return String(candidates.find((value) => String(value || '').trim()) || '').trim()
}

export type OzoneTrackingItem = {
  id: number
  ref: string
  tracking: string
  status: string
  STATUS?: string
  STATUT?: string
  STATUS_NAME?: string
  status_name?: string
  last_status?: string
  parcel_status?: string
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
  data?: OzoneTrackingItem | OzoneTrackingItem[] | Record<string, OzoneTrackingItem>
}

export type OzoneDeliveryNotePayload = {
  'dn-date': string
  'dn-remark'?: string
}

export type OzoneDeliveryNoteResponse = {
  success: boolean
  message: string
  ref?: string
  data?: {
    id: number
    ref: string
  }
}

export type OzoneAddParcelToDnPayload = {
  Ref: string
  Codes: string[]
}

export type OzoneSaveDnResponse = {
  success: boolean
  message: string
  ref?: string
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
export async function getOzoneParcelInfo(config: OzoneConfig, trackingNumber: string): Promise<OzoneTrackingResponse> {
  const url = buildUrl(config, '/parcel-info')
  const fd = toFormData({ 'tracking-number': trackingNumber })
  return ozoneFetch<OzoneTrackingResponse>(url, fd)
}

/**
 * Track un ou plusieurs colis
 * POST /customers/{id}/{key}/tracking
 * Supporte: single tracking-number (form-data) ou bulk (JSON body)
 */
export async function trackOzoneParcel(config: OzoneConfig, trackingNumber: string): Promise<OzoneTrackingResponse> {
  const url = buildUrl(config, '/tracking')
  const fd = toFormData({ 'tracking-number': trackingNumber })
  return ozoneFetch<OzoneTrackingResponse>(url, fd)
}

/**
 * Track multiple colis en bulk (JSON)
 * POST /customers/{id}/{key}/tracking
 */
export async function trackOzoneParcelsBulk(config: OzoneConfig, trackingNumbers: string[]): Promise<OzoneTrackingResponse> {
  const url = buildUrl(config, '/tracking')
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 'tracking-number': trackingNumbers }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`OZONE_BULK_TRACK_ERROR:${response.status}:${text}`)
  }
  return response.json() as Promise<OzoneTrackingResponse>
}

/**
 * Crée un bon de livraison (BL)
 * POST /customers/{id}/{key}/add-delivery-note (sans body, l'API génère un ref automatiquement)
 */
export async function createOzoneDeliveryNote(config: OzoneConfig, _payload?: OzoneDeliveryNotePayload): Promise<OzoneDeliveryNoteResponse> {
  const url = buildUrl(config, '/add-delivery-note')
  // Envoyer un FormData vide pour forcer le Content-Type multipart/form-data si nécessaire
  const fd = new FormData()
  const response = await fetch(url, { 
    method: 'POST',
    body: fd
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`OZONE_API_ERROR:${response.status}:${text}`)
  }
  return response.json() as Promise<OzoneDeliveryNoteResponse>
}


/**
 * Ajoute des colis à un BL existant
 * POST /customers/{id}/{key}/add-parcel-to-delivery-note (form-data)
 * Envoie Ref + Codes[0], Codes[1], ...
 */
export async function addParcelsToOzoneDeliveryNote(config: OzoneConfig, payload: OzoneAddParcelToDnPayload): Promise<OzoneDeliveryNoteResponse> {
  const url = buildUrl(config, '/add-parcel-to-delivery-note')
  const fd = new FormData()
  fd.append('Ref', payload.Ref)
  payload.Codes.forEach((code, index) => {
    fd.append(`Codes[${index}]`, code)
  })
  return ozoneFetch<OzoneDeliveryNoteResponse>(url, fd)
}

/**
 * Sauvegarde et finalise un BL
 * POST /customers/{id}/{key}/save-delivery-note (form-data)
 */
export async function saveOzoneDeliveryNote(config: OzoneConfig, dnRef: string): Promise<OzoneSaveDnResponse> {
  const url = buildUrl(config, '/save-delivery-note')
  const fd = toFormData({ Ref: dnRef })
  return ozoneFetch<OzoneSaveDnResponse>(url, fd)
}

/**
 * URL du PDF d'un BL
 */
export function getOzoneDeliveryNotePdfUrl(dnRef: string): string {
  return `https://client.ozoneexpress.ma/pdf-delivery-note?dn-ref=${encodeURIComponent(dnRef)}`
}

/**
 * URL des étiquettes A4 d'un BL
 */
export function getOzoneA4LabelsUrl(dnRef: string): string {
  return `https://client.ozoneexpress.ma/pdf-delivery-note-tickets?dn-ref=${encodeURIComponent(dnRef)}`
}

/**
 * URL des étiquettes 10x10cm d'un BL
 */
export function getOzone10x10LabelsUrl(dnRef: string): string {
  return `https://client.ozoneexpress.ma/pdf-delivery-note-tickets-4-4?dn-ref=${encodeURIComponent(dnRef)}`
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
