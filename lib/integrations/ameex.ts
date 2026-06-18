// ============================================================
// Client API AMEEX (api.ameex.app)
// Auth: C-Api-Id + C-Api-Key headers
// ============================================================

const AMEEX_API_BASE_URL = 'https://api.ameex.app'

export type AmeexParcelPayload = {
  type: 'SIMPLE' | 'STOCK'
  business: string
  order_num?: string
  replace?: 'true' | 'false'
  exchange_code?: string
  open?: 'YES' | 'NO'
  try?: 'YES' | 'NO'
  fragile?: '0' | '1'
  receiver: string
  phone: string
  city: string
  address: string
  comment?: string
  product?: string
  cod: string
}

export type AmeexParcelInfo = {
  CODE: string
  STATUT: string
  STATUT_S?: string
  STATUT_NAME?: string
  STATUT_S_NAME?: string
  COMMENT?: string
  DATE?: string
}

export type AmeexAddParcelResponse = {
  RESULT?: 'SUCCESS' | 'ERROR'
  MESSAGE?: string
  PARCEL?: {
    CODE: string
  }
}

export type AmeexTrackingResponse = {
  RESULT?: 'SUCCESS' | 'ERROR'
  MESSAGE?: string
  Parcel?: AmeexParcelInfo
}

export type AmeexDeliveryNoteResponse = {
  RESULT?: 'SUCCESS' | 'ERROR'
  MESSAGE?: string
  Ref?: string
}

export type AmeexStatusItem = {
  STATUT: string
  STATUT_NAME: string
  STATUT_COLOR: string
  STATUT_S?: string
  STATUT_S_NAME?: string
  STATUT_S_COLOR?: string
}

export type AmeexStatusListResponse = Array<AmeexStatusItem>

function truncate(value: string, max: number): string {
  return String(value || '').slice(0, max)
}

export function normalizeAmeexPhone(value: string): string {
  return String(value || '').replace(/\s+/g, '').trim()
}

async function ameexFetchFormData<T>(
  apiId: string,
  apiKey: string,
  path: string,
  formData: Record<string, string>,
): Promise<T> {
  const url = `${AMEEX_API_BASE_URL}${path}`
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(formData)) {
    body.append(key, value)
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'C-Api-Id': apiId,
      'C-Api-Key': apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`AMEEX_API_ERROR:${response.status}:${text}`)
  }

  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}

export async function validateAmeexCredentials(apiId: string, apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(`${AMEEX_API_BASE_URL}/customer/Delivery/Parcels/Statuts`, {
      method: 'GET',
      headers: {
        'C-Api-Id': apiId,
        'C-Api-Key': apiKey,
      },
    })
    return response.ok
  } catch {
    return false
  }
}

export async function createAmeexParcel(
  apiId: string,
  apiKey: string,
  payload: AmeexParcelPayload,
): Promise<AmeexAddParcelResponse> {
  const formData: Record<string, string> = {
    type: String(payload.type),
    business: String(payload.business),
    receiver: String(payload.receiver),
    phone: String(payload.phone),
    city: String(payload.city),
    address: String(payload.address),
    cod: String(payload.cod),
    open: String(payload.open),
    try: String(payload.try),
    fragile: String(payload.fragile),
    replace: String(payload.replace),
  }

  if (payload.order_num) formData.order_num = String(payload.order_num)
  if (payload.exchange_code) formData.exchange_code = String(payload.exchange_code)
  if (payload.comment) formData.comment = String(payload.comment)
  if (payload.product) formData.product = String(payload.product)

  return ameexFetchFormData<AmeexAddParcelResponse>(
    apiId, apiKey, '/customer/Delivery/Parcels/Action/Type/Add', formData,
  )
}

export async function editAmeexParcel(
  apiId: string,
  apiKey: string,
  parcelCode: string,
  payload: Partial<AmeexParcelPayload>,
): Promise<AmeexAddParcelResponse> {
  const formData: Record<string, string> = {}
  if (payload.order_num) formData.order_num = String(payload.order_num)
  if (payload.replace) formData.replace = String(payload.replace)
  if (payload.exchange_code) formData.exchange_code = String(payload.exchange_code)
  if (payload.open) formData.open = String(payload.open)
  if (payload.try) formData.try = String(payload.try)
  if (payload.fragile) formData.fragile = String(payload.fragile)
  if (payload.receiver) formData.receiver = String(payload.receiver)
  if (payload.phone) formData.phone = String(payload.phone)
  if (payload.city) formData.city = String(payload.city)
  if (payload.address) formData.address = String(payload.address)
  if (payload.comment) formData.comment = String(payload.comment)
  if (payload.product) formData.product = String(payload.product)
  if (payload.cod) formData.cod = String(payload.cod)

  return ameexFetchFormData<AmeexAddParcelResponse>(
    apiId, apiKey,
    `/customer/Delivery/Parcels/Action/Type/Edit?ParcelCode=${encodeURIComponent(parcelCode)}`,
    formData,
  )
}

export async function deleteAmeexParcel(apiId: string, apiKey: string, parcelCode: string): Promise<unknown> {
  const url = `${AMEEX_API_BASE_URL}/customer/Delivery/Parcels/Action/Type/Delete?ParcelCode=${encodeURIComponent(parcelCode)}`
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'C-Api-Id': apiId,
      'C-Api-Key': apiKey,
    },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`AMEEX_API_ERROR:${response.status}:${text}`)
  }
  return response.json()
}

export async function trackAmeexParcel(apiId: string, apiKey: string, parcelCode: string): Promise<AmeexTrackingResponse> {
  const url = `${AMEEX_API_BASE_URL}/customer/Delivery/Parcels/Tracking?ParcelCode=${encodeURIComponent(parcelCode)}`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'C-Api-Id': apiId,
      'C-Api-Key': apiKey,
    },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`AMEEX_API_ERROR:${response.status}:${text}`)
  }
  return response.json() as Promise<AmeexTrackingResponse>
}

export async function massTrackAmeexParcels(
  apiId: string,
  apiKey: string,
  codes: string[],
): Promise<unknown> {
  const formData: Record<string, string> = {
    codes: codes.slice(0, 25).join(','),
  }
  return ameexFetchFormData<unknown>(apiId, apiKey, '/customer/Delivery/Parcels/MassTracking', formData)
}

export async function getAmeexParcelInfo(apiId: string, apiKey: string, parcelCode: string): Promise<AmeexTrackingResponse> {
  const url = `${AMEEX_API_BASE_URL}/customer/Delivery/Parcels/Info?ParcelCode=${encodeURIComponent(parcelCode)}`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'C-Api-Id': apiId,
      'C-Api-Key': apiKey,
    },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`AMEEX_API_ERROR:${response.status}:${text}`)
  }
  return response.json() as Promise<AmeexTrackingResponse>
}

export async function listAmeexStatuses(apiId: string, apiKey: string): Promise<AmeexStatusListResponse> {
  const url = `${AMEEX_API_BASE_URL}/customer/Delivery/Parcels/Statuts`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'C-Api-Id': apiId,
      'C-Api-Key': apiKey,
    },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`AMEEX_API_ERROR:${response.status}:${text}`)
  }
  return response.json() as Promise<AmeexStatusListResponse>
}

export async function createAmeexDeliveryNote(
  apiId: string,
  apiKey: string,
  business: string,
): Promise<AmeexDeliveryNoteResponse> {
  const formData: Record<string, string> = { business }
  const raw = await ameexFetchFormData<Record<string, unknown>>(
    apiId, apiKey, '/customer/Delivery/DeliveryNotes/Action/Type/Add', formData,
  )

  // La reponse AMEEX peut varier. On tente plusieurs formats pour extraire la reference.
  const r = raw as any
  let ref = String(r?.Ref || '').trim()
  if (!ref) ref = String(r?.ref || '').trim()
  if (!ref) ref = String(r?.data?.ref || r?.data?.Ref || '').trim()
  if (!ref) ref = String(r?.api?.data?.ref || r?.api?.data?.Ref || '').trim()
  if (!ref) ref = String(r?.RESULT === 'SUCCESS' ? r?.MESSAGE || '' : '').trim()

  // Si toujours pas de ref, on logge et on leve une erreur avec la reponse brute
  if (!ref) {
    throw new Error(`AMEEX_DELIVERY_NOTE_CREATE_FAILED:Aucune reference retournee. Reponse: ${JSON.stringify(raw).slice(0, 500)}`)
  }

  return { RESULT: 'SUCCESS', Ref: ref }
}

export async function addParcelsToAmeexDeliveryNote(
  apiId: string,
  apiKey: string,
  ref: string,
  parcelCodes: string[],
): Promise<AmeexDeliveryNoteResponse> {
  const formData: Record<string, string> = {}
  parcelCodes.slice(0, 100).forEach((code, index) => {
    formData[`parcels[]`] = code
  })
  // AMEEX expects multiple parcels[] keys, so we need to build manually via URLSearchParams
  const url = `${AMEEX_API_BASE_URL}/customer/Delivery/DeliveryNotes/Action/Type/AddParcels?Ref=${encodeURIComponent(ref)}`
  const body = new URLSearchParams()
  parcelCodes.slice(0, 100).forEach((code) => {
    body.append('parcels[]', code)
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'C-Api-Id': apiId,
      'C-Api-Key': apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`AMEEX_API_ERROR:${response.status}:${text}`)
  }
  const text = await response.text()
  try {
    return JSON.parse(text) as AmeexDeliveryNoteResponse
  } catch {
    return { RESULT: 'SUCCESS', Ref: ref }
  }
}

export async function saveAmeexDeliveryNote(
  apiId: string,
  apiKey: string,
  ref: string,
): Promise<AmeexDeliveryNoteResponse> {
  const url = `${AMEEX_API_BASE_URL}/customer/Delivery/DeliveryNotes/Action/Type/Save?Ref=${encodeURIComponent(ref)}`
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'C-Api-Id': apiId,
      'C-Api-Key': apiKey,
    },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`AMEEX_API_ERROR:${response.status}:${text}`)
  }
  const text = await response.text()
  try {
    return JSON.parse(text) as AmeexDeliveryNoteResponse
  } catch {
    return { RESULT: 'SUCCESS', Ref: ref }
  }
}

export async function deleteAmeexDeliveryNote(
  apiId: string,
  apiKey: string,
  ref: string,
): Promise<unknown> {
  const url = `${AMEEX_API_BASE_URL}/customer/Delivery/DeliveryNotes/Action/Type/Delete?Ref=${encodeURIComponent(ref)}`
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'C-Api-Id': apiId,
      'C-Api-Key': apiKey,
    },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`AMEEX_API_ERROR:${response.status}:${text}`)
  }
  return response.json()
}

export async function downloadAmeexDeliveryNoteHtml(
  apiId: string,
  apiKey: string,
  ref: string,
): Promise<string> {
  const url = `${AMEEX_API_BASE_URL}/customer/Delivery/DeliveryNotes/Print/Type/Note?Ref=${encodeURIComponent(ref)}`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'C-Api-Id': apiId,
      'C-Api-Key': apiKey,
    },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`AMEEX_API_ERROR:${response.status}:${text}`)
  }
  return response.text()
}

export async function downloadAmeexLabelsHtml(
  apiId: string,
  apiKey: string,
  ref: string,
  labelType: string = 'Label_100_100',
): Promise<string> {
  const url = `${AMEEX_API_BASE_URL}/customer/Delivery/DeliveryNotes/Print/Type/Labels?Ref=${encodeURIComponent(ref)}&LabelType=${encodeURIComponent(labelType)}`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'C-Api-Id': apiId,
      'C-Api-Key': apiKey,
    },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`AMEEX_API_ERROR:${response.status}:${text}`)
  }
  return response.text()
}

export async function createAmeexPickupRequest(
  apiId: string,
  apiKey: string,
  payload: {
    business: string
    city: string
    address: string
    phone: string
    note?: string
    type?: string
  },
): Promise<unknown> {
  const formData: Record<string, string> = {
    mdl_business: payload.business,
    mdl_type: payload.type || 'PARCEL_M',
    mdl_city: payload.city,
    p_address: payload.address,
    p_phone: payload.phone,
  }
  if (payload.note) formData.p_note = payload.note

  return ameexFetchFormData<unknown>(apiId, apiKey, '/customer/Delivery/PickupRequests/Action/Type/Add', formData)
}

// ============================================================
// Status mapping AMEEX -> order/delivery status
// ============================================================

type StatusMapEntry = {
  matches: Array<{ statut: string; statut_s?: string }>
  orderStatus: string | null
  deliveryStatus: string
  statusDateField: string | null
}

function normalizeAmeexStatusValue(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export const AMEEX_STATUS_MAP: StatusMapEntry[] = [
  { matches: [{ statut: 'DELIVERED' }, { statut: 'LIVRE' }], orderStatus: 'delivered', deliveryStatus: 'delivered', statusDateField: 'delivered_at' },
  { matches: [{ statut: 'DISTRIBUTION' }, { statut: 'OUT_FOR_DELIVERY' }], orderStatus: 'dl_out_for_delivery', deliveryStatus: 'in_transit', statusDateField: 'dl_out_for_delivery_at' },
  { matches: [{ statut: 'IN_PROGRESS', statut_s: 'POSTPONED' }, { statut: 'REPORTE' }], orderStatus: 'dl_postponed', deliveryStatus: 'in_transit', statusDateField: 'dl_postponed_at' },
  { matches: [{ statut: 'IN_PROGRESS', statut_s: 'NO_ANSWER_TEAM' }], orderStatus: 'dl_no_answer', deliveryStatus: 'in_transit', statusDateField: 'dl_no_answer_at' },
  { matches: [{ statut: 'IN_PROGRESS', statut_s: 'NO_ANSWER' }], orderStatus: 'dl_no_answer', deliveryStatus: 'in_transit', statusDateField: 'dl_no_answer_at' },
  { matches: [{ statut: 'IN_PROGRESS', statut_s: 'UNREACHABLE' }], orderStatus: 'dl_unreachable', deliveryStatus: 'in_transit', statusDateField: 'dl_unreachable_at' },
  { matches: [{ statut: 'REFUSED' }, { statut: 'REFUSE' }], orderStatus: 'refused', deliveryStatus: 'refused', statusDateField: 'refused_at' },
  { matches: [{ statut: 'CANCELLED' }, { statut: 'ANNULE' }], orderStatus: 'cancelled', deliveryStatus: 'cancelled', statusDateField: 'cancelled_at' },
  { matches: [{ statut: 'RETURNED' }, { statut: 'RETOUR' }], orderStatus: 'returned_not_stocked', deliveryStatus: 'returned', statusDateField: 'returned_not_stocked_at' },
  { matches: [{ statut: 'PICKED_UP' }, { statut: 'RAMASSE' }], orderStatus: 'picked_up', deliveryStatus: 'picked_up', statusDateField: 'picked_up_at' },
  { matches: [{ statut: 'SENT' }, { statut: 'ENVOYE' }, { statut: 'SHIPPED' }], orderStatus: 'sent', deliveryStatus: 'in_transit', statusDateField: 'sent_at' },
  { matches: [{ statut: 'IN_PROGRESS' }], orderStatus: null, deliveryStatus: 'in_transit', statusDateField: null },
]

export function mapAmeexStatusToOrderStatus(
  rawStatut: string,
  rawStatutS?: string,
): { rawStatus: string; orderStatus: string | null; deliveryStatus: string; statusDateField: string | null } {
  const normalizedStatut = normalizeAmeexStatusValue(rawStatut)
  const normalizedStatutS = rawStatutS ? normalizeAmeexStatusValue(rawStatutS) : ''

  for (const entry of AMEEX_STATUS_MAP) {
    for (const match of entry.matches) {
      const statutMatch = normalizeAmeexStatusValue(match.statut)
      const statutSMatch = match.statut_s ? normalizeAmeexStatusValue(match.statut_s) : null

      if (normalizedStatut.includes(statutMatch) || statutMatch.includes(normalizedStatut)) {
        if (statutSMatch) {
          if (normalizedStatutS.includes(statutSMatch) || statutSMatch.includes(normalizedStatutS)) {
            return {
              rawStatus: rawStatut + (rawStatutS ? ` (${rawStatutS})` : ''),
              orderStatus: entry.orderStatus,
              deliveryStatus: entry.deliveryStatus,
              statusDateField: entry.statusDateField,
            }
          }
          continue
        }
        return {
          rawStatus: rawStatut,
          orderStatus: entry.orderStatus,
          deliveryStatus: entry.deliveryStatus,
          statusDateField: entry.statusDateField,
        }
      }
    }
  }

  return {
    rawStatus: rawStatut,
    orderStatus: null,
    deliveryStatus: 'pending',
    statusDateField: null,
  }
}