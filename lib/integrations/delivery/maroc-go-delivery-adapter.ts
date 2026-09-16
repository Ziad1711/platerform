// ============================================================
// Adapter Maroc Go Delivery implémentant DeliveryProvider
// Wrappe les fonctions de lib/integrations/maroc-go-delivery.ts
// (même API que Rapid Delivery, endpoint différent)
// ============================================================

import type { DeliveryIntegrationConfig, ParcelCreationInput, VoucherCreationInput, CreateParcelResult, CreateVoucherResult, TrackParcelResult } from './types'
import type { DeliveryProvider } from './provider'
import {
  createMarocGoDeliveryParcel,
  createMarocGoDeliveryVoucher,
  trackMarocGoDeliveryParcel,
  getMarocGoDeliveryVoucher,
  downloadMarocGoDeliveryHtml,
  normalizeMarocGoDeliveryPhone,
  getMarocGoDeliveryStateName,
  mapMarocGoDeliveryStateToOrderStatus,
} from '@/lib/integrations/maroc-go-delivery'
import type { MarocGoDeliveryTrackingPayload } from '@/lib/integrations/maroc-go-delivery'

function extractShortKeyFromHtml(html: string): string | null {
  const matches = html.match(/[A-Za-z0-9]{10}/g) || []
  return matches.find((m) => !['Imprimer', 'etiquetes', 'DOCTYPE'].includes(m)) || null
}

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

export const marocGoDeliveryAdapter: DeliveryProvider = {
  slug: 'maroc-go-delivery',

  async createParcel(config: DeliveryIntegrationConfig, input: ParcelCreationInput): Promise<CreateParcelResult> {
    const raw = await createMarocGoDeliveryParcel(config.token, {
      article: input.articleName,
      price: input.price,
      phone: normalizeMarocGoDeliveryPhone(input.phone),
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
    const raw = await createMarocGoDeliveryVoucher(config.token, {
      shop: input.shopKey,
      parcels: input.parcelKeys,
    })

    const providerVoucherKey = String((raw as any)?.data?.key || '').trim()
    if (!providerVoucherKey) throw new Error('INVALID_VOUCHER_KEY')

    return { providerVoucherKey, totalParcels: 0, raw }
  },

  async trackParcel(config: DeliveryIntegrationConfig, trackingNumber: string): Promise<TrackParcelResult> {
    const raw = await trackMarocGoDeliveryParcel(config.token, trackingNumber)
    const stateName = getMarocGoDeliveryStateName(raw)
    const mapped = mapMarocGoDeliveryStateToOrderStatus(stateName)

    return {
      rawStatus: mapped.rawStatus,
      orderStatus: mapped.orderStatus,
      deliveryStatus: mapped.deliveryStatus,
      statusDateField: mapped.statusDateField,
      raw,
    }
  },

  async getVoucher(config: DeliveryIntegrationConfig, voucherKey: string): Promise<unknown> {
    return getMarocGoDeliveryVoucher(config.token, voucherKey)
  },

  async downloadLabel(config: DeliveryIntegrationConfig, path: string) {
    const html = await downloadMarocGoDeliveryHtml(config.token, path)
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
      const remoteParcel = await trackMarocGoDeliveryParcel(config.token, uuid)
      const item = extractPayloadItem(remoteParcel) as MarocGoDeliveryTrackingPayload | undefined

      if (item?.key && !String(item.key).includes('-')) {
        return String(item.key).trim()
      }

      const html = await downloadMarocGoDeliveryHtml(config.token, `/parcels/${encodeURIComponent(uuid)}/label`)
      return extractShortKeyFromHtml(html)
    } catch (e) {
      console.warn('resolveShortTrackingKey failed', { uuid, error: e instanceof Error ? e.message : String(e) })
      return null
    }
  },
}
