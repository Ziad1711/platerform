const SENDIT_API_BASE_URL = 'https://app.sendit.ma/api/v1'

export type SenditCredentials = { publicKey: string; secretKey: string; token: string }

export type SenditParcelPayload = {
  pickup_district_id?: string
  district_id: string | number
  name: string
  amount: string | number
  address: string
  phone: string
  comment?: string
  reference?: string
  allow_open?: 0 | 1
  allow_try?: 0 | 1
  products_from_stock?: 0 | 1
  products?: string
  packaging_id?: string | number
  option_exchange?: 0 | 1
  delivery_exchange_id?: string
}

export type SenditDelivery = {
  code?: string
  status?: string
  fee?: number
  labelUrl?: string
  status_return?: string
}

export type SenditResponse<T> = { success?: boolean; message?: string; data?: T; error?: string }

async function senditFetch<T>(token: string, path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`${SENDIT_API_BASE_URL}${path}`, {
    method: options?.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  })

  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(`SENDIT_API_ERROR:${response.status}:${text}`)
  }
  return payload as T
}

export async function loginSendit(publicKey: string, secretKey: string) {
  const response = await fetch(`${SENDIT_API_BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ public_key: publicKey, secret_key: secretKey }),
  })
  const payload = (await response.json().catch(() => null)) as SenditResponse<{ token?: string; name?: string }> | null
  if (!response.ok || !payload?.data?.token) {
    throw new Error(payload?.message || payload?.error || 'SENDIT_LOGIN_FAILED')
  }
  return payload
}

export async function createSenditParcel(token: string, payload: SenditParcelPayload) {
  return senditFetch<SenditResponse<SenditDelivery>>(token, '/deliveries', { method: 'POST', body: payload })
}

export async function trackSenditParcel(token: string, code: string) {
  return senditFetch<SenditResponse<SenditDelivery>>(token, `/deliveries/${encodeURIComponent(code)}`)
}

export async function getSenditLabels(token: string, codes: string[], printFormat = 1) {
  return senditFetch<SenditResponse<{ filePrint?: boolean; fileUrl?: string }>>(token, '/deliveries/getlabels', {
    method: 'POST',
    body: { codesToPrint: codes.join(','), printFormat },
  })
}

export function normalizeSenditPhone(value: string) {
  return String(value || '').replace(/\s+/g, '').trim()
}

export function mapSenditStatusToOrderStatus(rawStatus: string) {
  const status = String(rawStatus || '').trim().toUpperCase()
  if (['DELIVERED', 'LIVRE', 'LIVRÉE'].includes(status)) return { orderStatus: 'delivered', deliveryStatus: 'delivered', statusDateField: 'delivered_at' }
  if (['CANCELED', 'CANCELLED', 'ANNULER', 'ANNULÉ'].includes(status)) return { orderStatus: 'cancelled', deliveryStatus: 'cancelled', statusDateField: 'cancelled_at' }
  if (['REFUSED', 'REFUSE', 'REFUSÉ'].includes(status)) return { orderStatus: 'refused', deliveryStatus: 'refused', statusDateField: 'refused_at' }
  if (status.includes('RETURN') || status.includes('RETOUR')) return { orderStatus: 'returned_not_stocked', deliveryStatus: 'returned', statusDateField: 'returned_not_stocked_at' }
  if (status.includes('TRANSIT') || status.includes('SENT')) return { orderStatus: 'sent', deliveryStatus: 'in_transit', statusDateField: 'sent_at' }
  return { orderStatus: null, deliveryStatus: 'pending', statusDateField: null }
}