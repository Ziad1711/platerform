// ============================================================
// Adapter OZONE Express implémentant DeliveryProvider
// ============================================================

import type { DeliveryIntegrationConfig, ParcelCreationInput, VoucherCreationInput, CreateParcelResult, CreateVoucherResult, TrackParcelResult } from './types'
import type { DeliveryProvider } from './provider'
import {
  createOzoneParcel,
  trackOzoneParcel,
  getOzoneParcelInfo,
  createOzoneDeliveryNote,
  addParcelsToOzoneDeliveryNote,
  saveOzoneDeliveryNote,
  getOzoneDeliveryNotePdfUrl,
  normalizeOzonePhone,
  isOzoneDeclaredValueRequired,
  type OzoneConfig,
  type OzoneTrackingItem,
} from '@/lib/integrations/ozone'

/**
 * Extrait le config OZONE depuis le token stocké (customerId|apiKey)
 */
function parseOzoneConfig(token: string): OzoneConfig {
  const parts = String(token || '').split('|')
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error('OZONE_INVALID_CONFIG')
  }
  return { customerId: parts[0].trim(), apiKey: parts[1].trim() }
}

/**
 * Statuts OZONE → statuts ERP
 */
const OZONE_STATUS_MAP: Array<{
  matches: string[]
  orderStatus: string
  deliveryStatus: string
  statusDateField: string
}> = [
  { matches: ['livrée', 'livre', 'delivered'], orderStatus: 'delivered', deliveryStatus: 'delivered', statusDateField: 'delivered_at' },
  { matches: ['refusée', 'refuse', 'refused'], orderStatus: 'refused', deliveryStatus: 'refused', statusDateField: 'refused_at' },
  { matches: ['annulée', 'annule', 'cancelled'], orderStatus: 'cancelled', deliveryStatus: 'cancelled', statusDateField: 'cancelled_at' },
  { matches: ['retournée', 'retourne', 'returned'], orderStatus: 'returned_not_stocked', deliveryStatus: 'returned', statusDateField: 'returned_not_stocked_at' },
  { matches: ['expédiée', 'expediee', 'expedie', 'shipped'], orderStatus: 'sent', deliveryStatus: 'in_transit', statusDateField: 'sent_at' },
  { matches: ['en cours', 'en cours de livraison', 'in progress'], orderStatus: '', deliveryStatus: 'in_transit', statusDateField: '' },
  { matches: ['préparée', 'preparee', 'prepared'], orderStatus: '', deliveryStatus: 'pickup_pending', statusDateField: '' },
  { matches: ['ramassée', 'ramassee', 'picked up'], orderStatus: 'picked_up', deliveryStatus: 'picked_up', statusDateField: 'picked_up_at' },
]

function normalizeOzoneStatusName(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function mapOzoneStatusToOrderStatus(rawStatus: string) {
  const normalized = normalizeOzoneStatusName(rawStatus)

  const match = OZONE_STATUS_MAP.find((item) =>
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

export const ozoneAdapter: DeliveryProvider = {
  slug: 'ozone',

  async createParcel(config: DeliveryIntegrationConfig, input: ParcelCreationInput): Promise<CreateParcelResult> {
    const ozoneConfig = parseOzoneConfig(config.token)
    const price = Number(input.price || 0)

    const payload: Record<string, string | number | undefined> = {
      'parcel-name': input.articleName,
      'parcel-phone': normalizeOzonePhone(input.phone),
      'parcel-city': input.cityKey,
      'parcel-price': price,
      'parcel-address': input.address || '',
      'parcel-receiver-name': input.recipient || '',
      'parcel-stock': 1,
    }

    if (isOzoneDeclaredValueRequired(price)) {
      payload['parcel-declared-value'] = price
    }

    if (input.remark) {
      payload['parcel-remark'] = input.remark
    }

    const raw = await createOzoneParcel(ozoneConfig, payload as any)

    if (!raw.success || !raw.data?.ref) {
      throw new Error(`OZONE_PARCEL_CREATE_FAILED:${raw.message}`)
    }

    return { providerId: raw.data.ref, raw }
  },

  async createVoucher(config: DeliveryIntegrationConfig, input: VoucherCreationInput): Promise<CreateVoucherResult> {
    const ozoneConfig = parseOzoneConfig(config.token)
    const now = new Date().toISOString().split('T')[0]

    // 1. Créer le BL
    const dnResult = await createOzoneDeliveryNote(ozoneConfig, {
      'dn-date': now,
    })

    if (!dnResult.success || !dnResult.data?.ref) {
      throw new Error(`OZONE_DN_CREATE_FAILED:${dnResult.message}`)
    }

    const dnRef = dnResult.data.ref

    // 2. Ajouter les colis au BL
    const parcelsRefs = input.parcelKeys.join(',')
    const addResult = await addParcelsToOzoneDeliveryNote(ozoneConfig, {
      'dn-ref': dnRef,
      'parcels-refs': parcelsRefs,
    })

    if (!addResult.success) {
      throw new Error(`OZONE_DN_ADD_PARCELS_FAILED:${addResult.message}`)
    }

    // 3. Sauvegarder le BL
    const saveResult = await saveOzoneDeliveryNote(ozoneConfig, dnRef)

    if (!saveResult.success) {
      throw new Error(`OZONE_DN_SAVE_FAILED:${saveResult.message}`)
    }

    return {
      providerVoucherKey: dnRef,
      totalParcels: input.parcelKeys.length,
      raw: { dn: dnResult.data, add: addResult.data, save: saveResult.data },
    }
  },

  async trackParcel(config: DeliveryIntegrationConfig, trackingNumber: string): Promise<TrackParcelResult> {
    const ozoneConfig = parseOzoneConfig(config.token)
    const raw = await trackOzoneParcel(ozoneConfig, trackingNumber)

    let rawStatus = ''
    if (raw.data) {
      const items = Array.isArray(raw.data) ? raw.data : [raw.data]
      const item = items[0] as OzoneTrackingItem | undefined
      rawStatus = item?.status || ''
    }

    const mapped = mapOzoneStatusToOrderStatus(rawStatus)

    return {
      rawStatus: mapped.rawStatus,
      orderStatus: mapped.orderStatus,
      deliveryStatus: mapped.deliveryStatus,
      statusDateField: mapped.statusDateField,
      raw,
    }
  },

  async getVoucher(config: DeliveryIntegrationConfig, voucherKey: string): Promise<unknown> {
    // OZONE n'a pas d'API GET /delivery-note/{ref}
    // On retourne un objet simple avec le ref
    return {
      ref: voucherKey,
      pdfUrl: getOzoneDeliveryNotePdfUrl(voucherKey),
    }
  },

  async downloadLabel(config: DeliveryIntegrationConfig, path: string) {
    // OZONE: les labels sont des PDFs de BL
    const pdfUrl = path.startsWith('http') ? path : getOzoneDeliveryNotePdfUrl(path)
    const response = await fetch(pdfUrl)

    if (!response.ok) {
      throw new Error(`OZONE_DOWNLOAD_ERROR:${response.status}`)
    }

    const body = await response.arrayBuffer()
    const contentType = response.headers.get('content-type') || 'application/pdf'
    const contentDisposition = response.headers.get('content-disposition') || `inline; filename="BL-${path}.pdf"`

    return {
      body,
      contentType,
      contentDisposition,
      byteLength: body.byteLength,
    }
  },
}
