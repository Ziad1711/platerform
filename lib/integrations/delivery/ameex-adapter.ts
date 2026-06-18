// ============================================================
// Adapter AMEEX implémentant DeliveryProvider
// ============================================================

import type { DeliveryIntegrationConfig, ParcelCreationInput, VoucherCreationInput, CreateParcelResult, CreateVoucherResult, TrackParcelResult } from './types'
import type { DeliveryProvider } from './provider'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAmeexCredentials } from '@/lib/integrations/ameex-credentials'
import { resolveDeliveryFee } from '@/lib/integrations/delivery/delivery-fee-resolver'
import {
  createAmeexParcel,
  trackAmeexParcel,
  createAmeexDeliveryNote,
  addParcelsToAmeexDeliveryNote,
  saveAmeexDeliveryNote,
  downloadAmeexDeliveryNoteHtml,
  downloadAmeexLabelsHtml,
  normalizeAmeexPhone,
  mapAmeexStatusToOrderStatus,
} from '@/lib/integrations/ameex'
import { createDeliveryLogger } from '@/lib/integrations/delivery/logger'

/**
 * Extrait le code colis AMEEX depuis la réponse, en tentant plusieurs formats possibles.
 */
function extractAmeexParcelCode(raw: unknown): string {
  const r = raw as Record<string, unknown> | null
  if (!r) return ''

  // Format attendu: { RESULT: 'SUCCESS', PARCEL: { CODE: '...' } }
  const fromParcelCode = String((r as any)?.PARCEL?.CODE || '').trim()
  if (fromParcelCode) return fromParcelCode

  // Format alternatif: { CODE: '...' } (sans wrapper PARCEL)
  const fromDirectCode = String((r as any)?.CODE || '').trim()
  if (fromDirectCode) return fromDirectCode

  // Format alternatif: { data: { CODE: '...' } }
  const fromDataCode = String((r as any)?.data?.CODE || '').trim()
  if (fromDataCode) return fromDataCode

  // Format alternatif: { data: { PARCEL: { CODE: '...' } } }
  const fromDataParcelCode = String((r as any)?.data?.PARCEL?.CODE || '').trim()
  if (fromDataParcelCode) return fromDataParcelCode

  // Format alternatif: { Parcel: { CODE: '...' } } (P majuscule)
  const fromParcelP = String((r as any)?.Parcel?.CODE || '').trim()
  if (fromParcelP) return fromParcelP

  // Format réel AMEEX: { login: 'success', api: { type: 'success', msg: '...', data: { id: 8455095, code: 'CSA...' } } }
  const fromApiDataCode = String((r as any)?.api?.data?.code || '').trim()
  if (fromApiDataCode) return fromApiDataCode

  // Format: { api: { data: { CODE: '...' } } }
  const fromApiDataCODE = String((r as any)?.api?.data?.CODE || '').trim()
  if (fromApiDataCODE) return fromApiDataCODE

  return ''
}

const AMEEX_PROVIDER_ID = '729e93ed-207f-4281-8ef6-de37006993de'

export const ameexAdapter: DeliveryProvider = {
  slug: 'ameex',

  async createParcel(config: DeliveryIntegrationConfig, input: ParcelCreationInput): Promise<CreateParcelResult> {
    const apiKey = config.apiKey || config.providerId || ''
    const raw = await createAmeexParcel(config.token, apiKey, {
      type: 'SIMPLE',
      business: String(input.shopKey || ''),
      receiver: String(input.recipient || 'Client').slice(0, 100),
      phone: normalizeAmeexPhone(input.phone).slice(0, 14),
      city: String(input.cityKey),
      address: String(input.address || 'Adresse non specifiee').slice(0, 200),
      cod: String(Number(input.price || 0)),
      open: input.options?.open === 2 ? 'NO' : 'YES',
      try: 'YES',
      fragile: input.options?.fragile === 1 ? '1' : '0',
      replace: input.options?.replace === 1 ? 'true' : 'false',
      product: input.articleName ? String(input.articleName).slice(0, 100) : undefined,
      order_num: input.remark ? String(input.remark).slice(0, 50) : undefined,
    })

    if ((raw as any)?.RESULT === 'ERROR') {
      throw new Error(`AMEEX_PARCEL_CREATE_FAILED:${(raw as any)?.MESSAGE || 'Erreur inconnue'}`)
    }

    const parcelCode = extractAmeexParcelCode(raw)
    if (!parcelCode) {
      throw new Error(`AMEEX_PARCEL_CREATE_FAILED: Aucun code colis retourne. Reponse: ${JSON.stringify(raw).slice(0, 500)}`)
    }

    return { providerId: parcelCode, raw }
  },

  async createVoucher(config: DeliveryIntegrationConfig, input: VoucherCreationInput): Promise<CreateVoucherResult> {
    // AMEEX Delivery Note flow: Add -> AddParcels -> Save
    const business = String(input.shopKey || '')
    const apiKey = config.apiKey || config.providerId || ''
    
    const note = await createAmeexDeliveryNote(config.token, apiKey, business)
    const ref = String((note as any)?.Ref || '').trim()
    if (!ref) {
      throw new Error('AMEEX_DELIVERY_NOTE_CREATE_FAILED: Aucune reference retournee')
    }

    const parcelKeys = input.parcelKeys.map(String).filter(Boolean)
    if (parcelKeys.length > 0) {
      await addParcelsToAmeexDeliveryNote(config.token, apiKey, ref, parcelKeys)
    }

    await saveAmeexDeliveryNote(config.token, apiKey, ref)

    return {
      providerVoucherKey: ref,
      totalParcels: parcelKeys.length,
      raw: note,
    }
  },

  async trackParcel(config: DeliveryIntegrationConfig, trackingNumber: string): Promise<TrackParcelResult> {
    const apiKey = config.apiKey || config.providerId || ''
    const raw = await trackAmeexParcel(config.token, apiKey, trackingNumber)
    const parcel = (raw as any)?.Parcel
    const rawStatut = String(parcel?.STATUT || '').trim()
    const rawStatutS = String(parcel?.STATUT_S || '').trim()
    const mapped = mapAmeexStatusToOrderStatus(rawStatut, rawStatutS || undefined)

    return {
      rawStatus: mapped.rawStatus,
      orderStatus: mapped.orderStatus,
      deliveryStatus: mapped.deliveryStatus,
      statusDateField: mapped.statusDateField,
      raw,
    }
  },

  async getVoucher(config: DeliveryIntegrationConfig, voucherKey: string): Promise<unknown> {
    return {
      key: voucherKey,
      provider: 'ameex',
      ref: voucherKey,
    }
  },

  async downloadLabel(config: DeliveryIntegrationConfig, path: string) {
    // path can be "note:REF" or "labels:REF:LabelType"
    const parts = path.split(':')
    const type = parts[0]
    const ref = parts[1] || path
    const labelType = parts[2] || 'Label_100_100'
    const apiKey = config.apiKey || config.providerId || ''

    let html: string
    if (type === 'labels') {
      html = await downloadAmeexLabelsHtml(config.token, apiKey, ref, labelType)
    } else {
      html = await downloadAmeexDeliveryNoteHtml(config.token, apiKey, ref)
    }

    const encoder = new TextEncoder()
    const body = encoder.encode(html).buffer as ArrayBuffer

    return {
      body,
      contentType: 'text/html; charset=utf-8',
      contentDisposition: `inline; filename="ameex-${ref}.html"`,
      byteLength: body.byteLength,
    }
  },
}

// ============================================================
// Fonction utilitaire pour creer un colis AMEEX directement
// depuis le flux orders/status
// ============================================================
export async function createAmeexParcelForOrder(params: {
  admin: ReturnType<typeof createAdminClient>
  orderId: string
  storeId: string
  userId: string
  integrationId: string
  deliveryNote?: string
  parcelType?: string
  canOpen?: boolean
  fragile?: boolean
  replace?: boolean
  tryEnabled?: boolean
}): Promise<{ trackingNumber: string; warning: string }> {
  const { admin, orderId, storeId, userId, integrationId, deliveryNote, parcelType, canOpen, fragile, replace, tryEnabled } = params
  const now = new Date().toISOString()

  const logger = createDeliveryLogger({ admin, integrationId, storeId, userId })

  // Recharger la commande
  const { data: order, error: orderError } = await admin
    .from('orders')
    .select(`
      id, store_id, status, city, address, phone, customer_name, total_selling_price,
      delivery_city_external_id, delivery_company_id, tracking_number, ameex_parcel_code,
      ameex_city_key,
      order_items(quantity, products(name))
    `)
    .eq('id', orderId)
    .maybeSingle()

  if (orderError) throw orderError
  if (!order) return { trackingNumber: '', warning: 'Commande introuvable.' }

  if (order.ameex_parcel_code || order.tracking_number) {
    logger.info('parcel-skip', 'Colis deja existant', { trackingNumber: order.ameex_parcel_code || order.tracking_number })
    return { trackingNumber: order.ameex_parcel_code || order.tracking_number || '', warning: '' }
  }

  // Recuperer la config AMEEX
  const { data: config } = await admin
    .from('ameex_configs')
    .select('*')
    .eq('store_id', storeId)
    .maybeSingle()

  // Ville
  let cityValue = String(order.delivery_city_external_id || order.ameex_city_key || '').trim()

  if (!cityValue) {
    logger.warn('parcel-city-not-found', 'Ville non reconnue pour AMEEX', { orderId, city: order.city })
    return { trackingNumber: '', warning: 'Veuillez choisir une ville Ameex dans le modal de confirmation.' }
  }

  // Resoudre les frais de livraison
  const deliveryFee = await resolveDeliveryFee({
    supabase: admin,
    storeId,
    cityKey: cityValue,
    integrationId,
    providerSlug: 'ameex',
  })

  // Recuperer l'integration pour le token
  const { data: integration } = await admin
    .from('integrations')
    .select('id')
    .eq('id', integrationId)
    .maybeSingle()

  if (!integration) return { trackingNumber: '', warning: 'Integration AMEEX non trouvee.' }

  const credentials = await getAmeexCredentials(admin, integration.id)
  const businessId = config?.business_id || credentials.apiId

  // Preparer le payload
  const orderProductNames = (order.order_items || [])
    .map((item: any) => String(item?.products?.name || '').trim())
    .filter(Boolean)
    .join(', ')

  logger.info('parcel-creating', 'Creation colis AMEEX', {
    orderId,
    city: cityValue,
    business: businessId,
  })

  const result = await createAmeexParcel(credentials.apiId, credentials.apiKey, {
    type: parcelType || config?.default_parcel_type || 'SIMPLE',
    business: businessId,
    receiver: String(order.customer_name || 'Client').slice(0, 100),
    phone: normalizeAmeexPhone(order.phone || '').slice(0, 14),
    city: String(cityValue).slice(0, 50),
    address: String(order.address || 'Adresse non specifiee').slice(0, 200),
    cod: String(Number(order.total_selling_price || 0)),
    open: canOpen !== undefined ? (canOpen ? 'YES' : 'NO') : (config?.default_open !== false ? 'YES' : 'NO'),
    try: tryEnabled !== undefined ? (tryEnabled ? 'YES' : 'NO') : (config?.default_try !== false ? 'YES' : 'NO'),
    fragile: fragile !== undefined ? (fragile ? '1' : '0') : (config?.default_fragile ? '1' : '0'),
    replace: replace !== undefined ? (replace ? 'true' : 'false') : (config?.default_replace !== false ? 'true' : 'false'),
    product: orderProductNames.slice(0, 100) || undefined,
    comment: deliveryNote ? String(deliveryNote).slice(0, 200) : undefined,
    order_num: String(order.id).slice(-50),
  })

  if ((result as any)?.RESULT === 'ERROR') {
    throw new Error(`AMEEX_PARCEL_CREATE_FAILED:${(result as any)?.MESSAGE || 'Erreur inconnue'}`)
  }

  const parcelCode = extractAmeexParcelCode(result)
  if (!parcelCode) {
    logger.error('parcel-no-code', 'Aucun code colis dans la reponse AMEEX', { rawResponse: JSON.stringify(result).slice(0, 1000) })
    throw new Error(`AMEEX_NO_PARCEL_CODE:${JSON.stringify(result).slice(0, 500)}`)
  }

  await admin.from('orders').update({
    tracking_number: parcelCode,
    external_delivery_id: parcelCode,
    ameex_parcel_code: parcelCode,
    ameex_city_key: cityValue,
    delivery_city_external_id: cityValue || null,
    delivery_fee: deliveryFee || 0,
    delivery_status: 'pending',
    delivery_status_source: 'delivery_company',
    last_delivery_sync_at: now,
    updated_at: now,
  }).eq('id', orderId)

  logger.info('parcel-created', 'Colis AMEEX cree avec succes', { parcelCode, deliveryFee })

  return { trackingNumber: parcelCode, warning: '' }
}