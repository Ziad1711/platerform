// ============================================================
// Client API Digylog — Tous les endpoints
// ============================================================

const DIGYLOG_BASE_URL = 'https://api.digylog.com/api/v2/seller'

export type DigylogConfig = {
  token: string
  referer?: string
}

function headers(cfg: DigylogConfig) {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${cfg.token}`,
  }
  if (cfg.referer) h.Referer = cfg.referer
  return h
}

async function apiFetch<T = any>(
  cfg: DigylogConfig,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${DIGYLOG_BASE_URL}${path}`
  const res = await fetch(url, {
    ...options,
    headers: { ...headers(cfg), ...(options.headers as Record<string, string> || {}) },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`DIGYLOG_API_ERROR:${res.status}:${text.slice(0, 500)}`)
  }
  return res.json()
}

// ─── Orders ───────────────────────────────────────────────

export type DigylogOrderRef = {
  ref?: string
  designation: string
  quantity: number
}

export type DigylogOrderInput = {
  num: string
  type?: number
  originTraking?: string
  name: string
  phone: string
  address: string
  city: string | number
  price: number
  openproduct?: 1 | 2
  port?: 1 | 2
  note?: string
  refs?: DigylogOrderRef[]
}

export type DigylogCreateOrdersPayload = {
  mode: 1 | 2
  network: number
  fc?: number
  store: string | number
  status: 0 | 1
  checkDuplicate?: 0 | 1
  orders: DigylogOrderInput[]
}

export async function createOrders(cfg: DigylogConfig, payload: DigylogCreateOrdersPayload) {
  return apiFetch(cfg, '/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getOrderInfos(cfg: DigylogConfig, tracking: string) {
  return apiFetch(cfg, `/order/${encodeURIComponent(tracking)}/infos`)
}

export async function getOrderMinInfos(cfg: DigylogConfig, tracking: string) {
  return apiFetch(cfg, `/order/${encodeURIComponent(tracking)}/infos?min=true`)
}

export async function getOrderHistorics(cfg: DigylogConfig, trackings: string[]) {
  const q = trackings.join(',')
  return apiFetch(cfg, `/historics?trackings=${encodeURIComponent(q)}`)
}

export async function downloadLabels(cfg: DigylogConfig, orders: string[]) {
  return apiFetch(cfg, '/labels', {
    method: 'POST',
    body: JSON.stringify({ orders }),
  })
}

export async function sendOrders(cfg: DigylogConfig, orders: string[]) {
  return apiFetch(cfg, '/orders/send', {
    method: 'PUT',
    body: JSON.stringify({ orders }),
  })
}

// ─── BLS ──────────────────────────────────────────────────

export async function getBls(cfg: DigylogConfig, currentPage = 1) {
  return apiFetch(cfg, `/bls?currentPage=${currentPage}`)
}

export async function getBlOrders(cfg: DigylogConfig, blId: number) {
  return apiFetch(cfg, `/bls/${blId}/orders`)
}

export async function downloadBlPdf(cfg: DigylogConfig, blId: number) {
  return apiFetch(cfg, `/bl/${blId}/pdf`)
}

export async function downloadBlLabels(cfg: DigylogConfig, blId: number) {
  return apiFetch(cfg, '/labels', {
    method: 'POST',
    body: JSON.stringify({ bl: blId }),
  })
}

// ─── BRS ──────────────────────────────────────────────────

export async function getBrs(cfg: DigylogConfig, currentPage = 1) {
  return apiFetch(cfg, `/brs?currentPage=${currentPage}`)
}

export async function getBrOrders(cfg: DigylogConfig, brId: number) {
  return apiFetch(cfg, `/brs/${brId}/orders`)
}

// ─── Complaint ────────────────────────────────────────────

export async function createComplaint(cfg: DigylogConfig, body: Record<string, any>) {
  return apiFetch(cfg, '/complaints', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function getComplaintTypes(cfg: DigylogConfig) {
  return apiFetch(cfg, '/complaint-types')
}

export async function checkComplaintEligibility(cfg: DigylogConfig, tracking: string, type: number) {
  return apiFetch(cfg, `/complaints/${encodeURIComponent(tracking)}/check?type=${type}`)
}

// ─── Store ────────────────────────────────────────────────

export async function addStore(cfg: DigylogConfig, name: string, phone: string) {
  return apiFetch(cfg, '/stores', {
    method: 'POST',
    body: JSON.stringify({ name, phone }),
  })
}

export async function getStores(cfg: DigylogConfig) {
  return apiFetch(cfg, '/stores')
}

// ─── City ─────────────────────────────────────────────────

export async function getCities(cfg: DigylogConfig) {
  return apiFetch(cfg, '/cities')
}

// ─── Network ──────────────────────────────────────────────

export async function getNetworks(cfg: DigylogConfig) {
  return apiFetch(cfg, '/networks')
}

export async function addNetwork(cfg: DigylogConfig, network: number) {
  return apiFetch(cfg, '/networks', {
    method: 'POST',
    body: JSON.stringify({ network }),
  })
}

// ─── Status ───────────────────────────────────────────────

export async function getStatuses(cfg: DigylogConfig) {
  return apiFetch(cfg, '/statuses')
}

// ─── Webhook ──────────────────────────────────────────────

export async function registerWebhook(cfg: DigylogConfig, url: string) {
  return apiFetch(cfg, '/webhook', {
    method: 'PUT',
    body: JSON.stringify({ url }),
  })
}

export async function getWebhookEvents(cfg: DigylogConfig) {
  return apiFetch(cfg, '/webhook/events')
}

export async function deleteWebhook(cfg: DigylogConfig) {
  return apiFetch(cfg, '/webhook', { method: 'DELETE' })
}

// ─── Pickup ───────────────────────────────────────────────

export async function getPickupAreas(cfg: DigylogConfig, network: number) {
  return apiFetch(cfg, `/pickup/areas?network=${network}`)
}

export async function getLastPickup(cfg: DigylogConfig, network: number) {
  return apiFetch(cfg, `/lastpickup?network=${network}`)
}

export async function createPickupRequest(cfg: DigylogConfig, area: number, phone: string) {
  return apiFetch(cfg, '/pickup/request', {
    method: 'POST',
    body: JSON.stringify({ area, phone }),
  })
}

export async function cancelPickupRequest(cfg: DigylogConfig, id: number) {
  return apiFetch(cfg, `/pickup/${id}/cancel`, { method: 'PUT' })
}

// ─── Delivery cost ────────────────────────────────────────

export async function getDeliveryCost(cfg: DigylogConfig, network: number, city: number) {
  return apiFetch(cfg, `/deliverycost?network=${network}&city=${city}`)
}

export async function getEstimatedDeliveryCost(
  cfg: DigylogConfig,
  params: { network: number; city: number; height: number; width: number; length: number; weight: number }
) {
  const q = `network=${params.network}&city=${params.city}&height=${params.height}&width=${params.width}&length=${params.length}&weight=${params.weight}`
  return apiFetch(cfg, `/calculate-delivery?${q}`)
}

export async function getAllPrices(cfg: DigylogConfig, network: number) {
  return apiFetch(cfg, `/prices?network=${network}`)
}

// ─── Customer metrics ─────────────────────────────────────

export async function getCustomerMetrics(cfg: DigylogConfig, phone: string) {
  return apiFetch(cfg, `/metrics/customer?phone=${encodeURIComponent(phone)}`)
}

// ─── Status mapping ───────────────────────────────────────

/**
 * Mappe le statut Digylog (idStatus ou label) vers nos statuts internes.
 */
export function mapDigylogStatusToOrderStatus(rawStatus: string, idStatus?: string | number): {
  orderStatus: string | null
  deliveryStatus: string
  statusDateField: string | null
} {
  const id = String(idStatus ?? '').trim()
  const label = rawStatus.toLowerCase().trim()

  // Par ID status Digylog
  if (id === '1') return { orderStatus: null, deliveryStatus: 'pending', statusDateField: null }
  if (id === '2') return { orderStatus: 'sent', deliveryStatus: 'in_transit', statusDateField: 'sent_at' }
  if (id === '3') return { orderStatus: 'dl_out_for_delivery', deliveryStatus: 'out_for_delivery', statusDateField: 'dl_out_for_delivery_at' }
  if (id === '4') return { orderStatus: 'dl_no_answer', deliveryStatus: 'attempt_failed', statusDateField: 'dl_no_answer_at' }
  if (id === '5') return { orderStatus: 'dl_postponed', deliveryStatus: 'postponed', statusDateField: 'dl_postponed_at' }
  if (id === '6') return { orderStatus: 'delivered', deliveryStatus: 'delivered', statusDateField: 'delivered_at' }
  if (id === '7') return { orderStatus: 'refused', deliveryStatus: 'refused', statusDateField: 'refused_at' }
  if (id === '8') return { orderStatus: 'returned_not_stocked', deliveryStatus: 'returned', statusDateField: 'returned_not_stocked_at' }
  if (id === '9') return { orderStatus: 'returned_stocked', deliveryStatus: 'returned_stocked', statusDateField: 'returned_stocked_at' }
  if (id === '10') return { orderStatus: 'cancelled', deliveryStatus: 'cancelled', statusDateField: 'cancelled_at' }

  // Fallback par label
  if (label.includes('livré') || label.includes('livree')) return { orderStatus: 'delivered', deliveryStatus: 'delivered', statusDateField: 'delivered_at' }
  if (label.includes('refus')) return { orderStatus: 'refused', deliveryStatus: 'refused', statusDateField: 'refused_at' }
  if (label.includes('retour') || label.includes('return')) return { orderStatus: 'returned_not_stocked', deliveryStatus: 'returned', statusDateField: 'returned_not_stocked_at' }
  if (label.includes('annul')) return { orderStatus: 'cancelled', deliveryStatus: 'cancelled', statusDateField: 'cancelled_at' }
  if (label.includes('sortie') || label.includes('livraison')) return { orderStatus: 'dl_out_for_delivery', deliveryStatus: 'out_for_delivery', statusDateField: 'dl_out_for_delivery_at' }
  if (label.includes('envoyé') || label.includes('envoye') || label.includes('expédié') || label.includes('expedie')) return { orderStatus: 'sent', deliveryStatus: 'in_transit', statusDateField: 'sent_at' }
  if (label.includes('pas de réponse') || label.includes('pas de reponse')) return { orderStatus: 'dl_no_answer', deliveryStatus: 'attempt_failed', statusDateField: 'dl_no_answer_at' }
  if (label.includes('report')) return { orderStatus: 'dl_postponed', deliveryStatus: 'postponed', statusDateField: 'dl_postponed_at' }

  return { orderStatus: null, deliveryStatus: 'pending', statusDateField: null }
}
