// ============================================================
// Adapter RapidDelivery implémentant DeliveryProvider
// Wrappe les fonctions existantes de lib/integrations/rapid-delivery.ts
// ============================================================

import type { DeliveryIntegrationConfig, ParcelCreationInput, VoucherCreationInput, CreateParcelResult, CreateVoucherResult, TrackParcelResult } from './types'
import type { DeliveryProvider } from './provider'
import {
  createRapidDeliveryParcel,
  createRapidDeliveryVoucher,
  trackRapidDeliveryParcel,
  getRapidDeliveryVoucher,
  downloadRapidDeliveryHtml,
  normalizeRapidDeliveryPhone,
  getRapidDeliveryStateName,
  mapRapidDeliveryStateToOrderStatus,
} from '@/lib/integrations/rapid-delivery'
import type { RapidDeliveryTrackingPayload } from '@/lib/integrations/rapid-delivery'

/**
 * Extrait une clé courte depuis le HTML d'un label
 */
function extractShortKeyFromHtml(html: string): string | null {
  const matches = html.match(/[A-Za-z0-9]{10}/g) || []
  return matches.find(m => !['Imprimer', 'etiquetes', 'DOCTYPE'].includes(m)) || null
}

/**
 * Extrait le premier item du payload de tracking RapidDelivery
 */
function extractPayloadItem(payload: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(payload)) return payload[0] as Record<string, unknown> | undefined
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (Array.isArray(record.data)) return (record.data[0] || null) as Record<string, unknown> | undefined
    if (Array.isArray(record.Data)) return (record.Data[0] || null) as Record<string, unknown> | undefined
    return record
  }
  return undefined
}

export const rapidDeliveryAdapter: DeliveryProvider = {
  slug: 'rapid-delivery',

  async createParcel(config: DeliveryIntegrationConfig, input: ParcelCreationInput): Promise<CreateParcelResult> {
    const raw = await createRapidDeliveryParcel(config.token, {
      article: input.articleName,
      price: input.price,
      phone: normalizeRapidDeliveryPhone(input.phone),
      city: input.cityKey,
      shop: input.shopKey,
      address: input.address || undefined,
      recipient: input.recipient || undefined,
      remark: input.remark || undefined,
    })

    const providerId = String((raw as any)?.data?.key || '').trim()
    if (!providerId) throw new Error('INVALID_TRACKING_NUMBER_UUID')

    return { providerId, raw }
  },

  async createVoucher(config: DeliveryIntegrationConfig, input: VoucherCreationInput): Promise<CreateVoucherResult> {
    const raw = await createRapidDeliveryVoucher(config.token, {
      shop: input.shopKey,
      parcels: input.parcelKeys,
    })

    const providerVoucherKey = String((raw as any)?.data?.key || '').trim()
    if (!providerVoucherKey) throw new Error('INVALID_VOUCHER_KEY')

    return { providerVoucherKey, totalParcels: 0, raw }
  },

  async trackParcel(config: DeliveryIntegrationConfig, trackingNumber: string): Promise<TrackParcelResult> {
    const raw = await trackRapidDeliveryParcel(config.token, trackingNumber)
    const stateName = getRapidDeliveryStateName(raw)
    const mapped = mapRapidDeliveryStateToOrderStatus(stateName)

    return {
      rawStatus: mapped.rawStatus,
      orderStatus: mapped.orderStatus,
      deliveryStatus: mapped.deliveryStatus,
      statusDateField: mapped.statusDateField,
      raw,
    }
  },

  async getVoucher(config: DeliveryIntegrationConfig, voucherKey: string): Promise<unknown> {
    return getRapidDeliveryVoucher(config.token, voucherKey)
  },

  async downloadLabel(config: DeliveryIntegrationConfig, path: string) {
    const html = await downloadRapidDeliveryHtml(config.token, path)
    const encoder = new TextEncoder()
    const body = encoder.encode(html).buffer as ArrayBuffer
    return {
      body,
      contentType: 'text/html; charset=utf-8',
      contentDisposition: 'inline',
      byteLength: body.byteLength,
    }
  },

  async resolveShortTrackingKey(config: DeliveryIntegrationConfig, uuid: string): Promise<string | null> {
    try {
      // Essayer d'abord via le tracking JSON
      const remoteParcel = await trackRapidDeliveryParcel(config.token, uuid)
      const item = extractPayloadItem(remoteParcel) as RapidDeliveryTrackingPayload | undefined

      // Vérifier si le key n'est pas un UUID
      if (item?.key && !String(item.key).includes('-')) {
        return String(item.key).trim()
      }

      // Fallback: extraire du label HTML
      const html = await downloadRapidDeliveryHtml(config.token, `/parcels/${encodeURIComponent(uuid)}/label`)
      return extractShortKeyFromHtml(html)
    } catch (e) {
      console.warn('resolveShortTrackingKey failed', { uuid, error: e instanceof Error ? e.message : String(e) })
      return null
    }
  },
}
