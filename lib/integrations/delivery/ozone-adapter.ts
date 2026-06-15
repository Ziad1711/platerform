// ============================================================
// Adapter OZONE Express implémentant DeliveryProvider
// ============================================================

import type { DeliveryIntegrationConfig, ParcelCreationInput, VoucherCreationInput, CreateParcelResult, CreateVoucherResult, TrackParcelResult } from './types'
import type { DeliveryProvider } from './provider'
import {
  createOzoneParcel,
  extractOzoneTrackingNumber,
  trackOzoneParcel,
  createOzoneDeliveryNote,
  addParcelsToOzoneDeliveryNote,
  saveOzoneDeliveryNote,
  getOzoneDeliveryNotePdfUrl,
  normalizeOzonePhone,
  isOzoneDeclaredValueRequired,
  type OzoneConfig,
  type OzoneTrackingItem,
  type OzoneTrackingResponse,
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
  orderStatus: string | null
  deliveryStatus: string
  statusDateField: string | null
}> = [
  { matches: ['livre', 'delivered', 'livree'], orderStatus: 'delivered', deliveryStatus: 'delivered', statusDateField: 'delivered_at' },
  { matches: ['refuse', 'refused', 'refusee'], orderStatus: 'refused', deliveryStatus: 'refused', statusDateField: 'refused_at' },
  { matches: ['annule', 'cancelled', 'annulee'], orderStatus: 'cancelled', deliveryStatus: 'cancelled', statusDateField: 'cancelled_at' },
  { matches: ['retourne', 'en retour par amana', 'returned', 'retournee'], orderStatus: 'returned_not_stocked', deliveryStatus: 'returned', statusDateField: 'returned_not_stocked_at' },
  { matches: ['rembourse'], orderStatus: 'dl_refund', deliveryStatus: 'returned', statusDateField: 'dl_refund_at' },
  { matches: ['ramasse', 'saisi par barid al maghrib', 'ramassee'], orderStatus: 'picked_up', deliveryStatus: 'picked_up', statusDateField: 'picked_up_at' },
  { matches: ['pre ramasse', 'programme', 'recu', 'recu en agence de livraison', 'en attente de ramassage'], orderStatus: 'dl_pickup_pending', deliveryStatus: 'pickup_pending', statusDateField: 'dl_pickup_pending_at' },
  { matches: ['mise en distribution', 'sortie pour livraison'], orderStatus: 'dl_out_for_delivery', deliveryStatus: 'in_transit', statusDateField: 'dl_out_for_delivery_at' },
  { matches: ['en voyage', 'expedie', 'envoye a l agence', 'en cours', 'expediee'], orderStatus: 'sent', deliveryStatus: 'in_transit', statusDateField: 'sent_at' },
  { matches: ['pas de reponse', 'pas reponse', 'boite vocal'], orderStatus: 'dl_no_answer', deliveryStatus: 'in_transit', statusDateField: 'dl_no_answer_at' },
  { matches: ['injoignable'], orderStatus: 'dl_unreachable', deliveryStatus: 'in_transit', statusDateField: 'dl_unreachable_at' },
  { matches: ['zone non couverte', 'hors zone', 'hors secteur', 'hors-zone'], orderStatus: 'dl_out_of_zone', deliveryStatus: 'returned', statusDateField: 'dl_out_of_zone_at' },
  { matches: ['client interesse', 'livraison sous conditions'], orderStatus: 'dl_client_interested', deliveryStatus: 'in_transit', statusDateField: 'dl_client_interested_at' },
  { matches: ['reporte', 'retarde'], orderStatus: 'dl_postponed', deliveryStatus: 'in_transit', statusDateField: 'dl_postponed_at' },
  { matches: ['sans adresse'], orderStatus: 'dl_address_change', deliveryStatus: 'in_transit', statusDateField: 'dl_address_change_at' },
  { matches: ['erreur numero'], orderStatus: 'wrong_number', deliveryStatus: 'in_transit', statusDateField: 'wrong_number_at' },
  { matches: ['test statut'], orderStatus: null, deliveryStatus: 'pending', statusDateField: null },
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

function extractOzoneTrackingItems(raw: OzoneTrackingResponse): OzoneTrackingItem[] {
  if (!raw.data) return []
  if (Array.isArray(raw.data)) return raw.data
  if ('status' in raw.data || 'status_name' in raw.data || 'last_status' in raw.data || 'parcel_status' in raw.data) {
    return [raw.data as OzoneTrackingItem]
  }
  return Object.values(raw.data).filter(Boolean) as OzoneTrackingItem[]
}

function getOzoneRawStatus(item?: OzoneTrackingItem) {
  return item?.status || item?.STATUS || item?.STATUT || item?.status_name || item?.STATUS_NAME || item?.last_status || item?.parcel_status || ''
}

export const ozoneAdapter: DeliveryProvider = {
  slug: 'ozone',

  async createParcel(config: DeliveryIntegrationConfig, input: ParcelCreationInput): Promise<CreateParcelResult> {
    const ozoneConfig = parseOzoneConfig(config.token)
    const price = Number(input.price || 0)

    const payload: Record<string, string | number | undefined> = {
      'parcel-nature': input.articleName,
      'parcel-phone': normalizeOzonePhone(input.phone),
      'parcel-city': input.cityKey,
      'parcel-price': price,
      'parcel-address': input.address || '',
      'parcel-receiver': input.recipient || '',
      'parcel-stock': 1,
    }

    if (isOzoneDeclaredValueRequired(price)) {
      payload['parcel-declared-value'] = price
    }

    if (input.remark) {
      payload['parcel-note'] = input.remark
    }

    if (input.options?.open) payload['parcel-open'] = input.options.open
    if (input.options?.fragile !== undefined) payload['parcel-fragile'] = input.options.fragile
    if (input.options?.replace !== undefined) payload['parcel-replace'] = input.options.replace

    const raw = await createOzoneParcel(ozoneConfig, payload as any)
    const trackingNumber = extractOzoneTrackingNumber(raw)

    if (!trackingNumber) {
      throw new Error(`OZONE_PARCEL_CREATE_FAILED:${raw.message}`)
    }

    return { providerId: trackingNumber, raw }
  },

  async createVoucher(config: DeliveryIntegrationConfig, input: VoucherCreationInput): Promise<CreateVoucherResult> {
    const ozoneConfig = parseOzoneConfig(config.token)
    const now = new Date().toISOString().split('T')[0]

    // 1. Créer le BL (POST sans body, l'API génère un ref automatiquement)
    const dnResult = await createOzoneDeliveryNote(ozoneConfig)

    // La réponse OZONE peut être très imbriquée selon la version de leur API
    const dnRef = 
      dnResult.ref || 
      (dnResult as any).REF || 
      dnResult.data?.ref || 
      (dnResult.data as any)?.REF ||
      (dnResult as any)?.['ADD-BL']?.['NEW-BL']?.REF ||
      (dnResult as any)?.['ADD-BL']?.['NEW-BL']?.ref ||
      ''

    if (!dnRef) {
      throw new Error(`OZONE_DN_CREATE_FAILED: No reference found in response. Raw: ${JSON.stringify(dnResult)}`)
    }

    // 2. Ajouter les colis au BL
    const addResult = await addParcelsToOzoneDeliveryNote(ozoneConfig, {
      Ref: dnRef,
      Codes: input.parcelKeys.map(String),
    })

    // On vérifie si l'ajout a été explicitement rejeté par l'API Ozone
    if ((addResult as any)?.['ADD-PARCEL-TO-BL']?.RESULT === 'FAILED') {
       throw new Error(`OZONE_DN_ADD_PARCELS_FAILED: ${(addResult as any)?.['ADD-PARCEL-TO-BL']?.MESSAGE || 'Unknown error'}`)
    }

    // 3. Sauvegarder le BL
    const saveResult = await saveOzoneDeliveryNote(ozoneConfig, dnRef)

    // On vérifie si la sauvegarde a été explicitement rejetée
    if ((saveResult as any)?.['SAVE-BL']?.RESULT === 'FAILED') {
       throw new Error(`OZONE_DN_SAVE_FAILED: ${(saveResult as any)?.['SAVE-BL']?.MESSAGE || 'Unknown error'}`)
    }

    return {
      providerVoucherKey: dnRef,
      totalParcels: input.parcelKeys.length,
      raw: { dn: dnResult, add: addResult, save: saveResult },
    }
  },

  async trackParcel(config: DeliveryIntegrationConfig, trackingNumber: string): Promise<TrackParcelResult> {
    const ozoneConfig = parseOzoneConfig(config.token)
    const raw = await trackOzoneParcel(ozoneConfig, trackingNumber)

    const item = extractOzoneTrackingItems(raw)[0]
    const rawStatus = getOzoneRawStatus(item)

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
