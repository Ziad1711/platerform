// ============================================================
// Adapter ForceLog implémentant DeliveryProvider
// ============================================================

import type { DeliveryIntegrationConfig, ParcelCreationInput, VoucherCreationInput, CreateParcelResult, CreateVoucherResult, TrackParcelResult } from './types'
import type { DeliveryProvider } from './provider'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDecryptedIntegrationToken } from '@/lib/integrations/rapid-delivery-connect'
import { normalizeOrderCityById } from '@/lib/integrations/city-normalizer'
import { resolveDeliveryFee } from '@/lib/integrations/delivery/delivery-fee-resolver'
import {
  createForceLogParcel,
  trackForceLogParcel,
  downloadForceLogSticker,
  createForceLogPickupRequest,
  normalizeForceLogPhone,
  mapForceLogStatusToOrderStatus,
} from '@/lib/integrations/forcelog'
import { createDeliveryLogger } from '@/lib/integrations/delivery/logger'

export const forcelogAdapter: DeliveryProvider = {
  slug: 'forcelog',

  async createParcel(config: DeliveryIntegrationConfig, input: ParcelCreationInput): Promise<CreateParcelResult> {
    const raw = await createForceLogParcel(config.token, {
      ORDER_NUM: String(input.remark || input.articleName || 'ORDER').slice(0, 20),
      RECEIVER: String(input.recipient || 'Client').slice(0, 50),
      PHONE: normalizeForceLogPhone(input.phone).slice(0, 14),
      CITY: String(input.cityKey),
      ADDRESS: String(input.address || 'Adresse non spécifiée').slice(0, 100),
      COMMENT: input.remark ? String(input.remark).slice(0, 100) : undefined,
      PRODUCT_NATURE: input.articleName ? String(input.articleName).slice(0, 100) : undefined,
      COD: Number(input.price || 0),
      CAN_OPEN: input.options?.open === 1 ? false : true,
      FRAGILE: input.options?.fragile === 1 ? true : false,
    })

    if ((raw as any)?.['ADD-PARCEL']?.RESULT === 'ERROR') {
      throw new Error(`FORCELOG_PARCEL_CREATE_FAILED:${(raw as any)?.['ADD-PARCEL']?.MESSAGE || 'Unknown error'}`)
    }

    const trackingNumber = String((raw as any)?.['ADD-PARCEL']?.['NEW-PARCEL']?.TRACKING_NUMBER || '').trim()
    if (!trackingNumber) {
      throw new Error('FORCELOG_PARCEL_CREATE_FAILED: No tracking number returned')
    }

    return { providerId: trackingNumber, raw }
  },

  async createVoucher(config: DeliveryIntegrationConfig, input: VoucherCreationInput): Promise<CreateVoucherResult> {
    // ForceLog n'a pas de vrai "bon de ramassage" avec liste de colis dans la doc.
    // On crée une demande de ramassage simple via pickup.
    // Le voucherKey est un UUID interne généré ici.
    // Les colis sont déjà créés individuellement.
    const internalKey = `forcelog_pickup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    
    return {
      providerVoucherKey: internalKey,
      totalParcels: input.parcelKeys.length,
      raw: { internal: true, pickupKey: internalKey },
    }
  },

  async trackParcel(config: DeliveryIntegrationConfig, trackingNumber: string): Promise<TrackParcelResult> {
    const raw = await trackForceLogParcel(config.token, trackingNumber)
    
    if ((raw as any)?.RESULT === 'ERROR') {
      throw new Error(`FORCELOG_TRACK_FAILED:${(raw as any)?.MESSAGE || 'Unknown error'}`)
    }

    const rawStatus = String((raw as any)?.PARCEL?.STATUS || '').trim()
    const mapped = mapForceLogStatusToOrderStatus(rawStatus)

    return {
      rawStatus: mapped.rawStatus,
      orderStatus: mapped.orderStatus,
      deliveryStatus: mapped.deliveryStatus,
      statusDateField: mapped.statusDateField,
      raw,
    }
  },

  async getVoucher(config: DeliveryIntegrationConfig, voucherKey: string): Promise<unknown> {
    // ForceLog n'a pas d'API GET /voucher
    return {
      key: voucherKey,
      provider: 'forcelog',
    }
  },

  async downloadLabel(config: DeliveryIntegrationConfig, path: string) {
    const body = await downloadForceLogSticker(config.token, path)
    return {
      body,
      contentType: 'application/pdf',
      contentDisposition: `inline; filename="forcelog-${path}.pdf"`,
      byteLength: body.byteLength,
    }
  },
}

// ============================================================
// Fonction utilitaire pour créer un colis ForceLog directement
// depuis le flux orders/status (évite le fetch interne non auth)
// ============================================================
export async function createForceLogParcelForOrder(params: {
  admin: ReturnType<typeof createAdminClient>
  orderId: string
  storeId: string
  userId: string
  integrationId: string
  deliveryNote?: string
  canOpen?: boolean
  fragile?: boolean
  productNature?: string
}): Promise<{ trackingNumber: string; warning: string }> {
  const { admin, orderId, storeId, userId, integrationId, deliveryNote, canOpen, fragile, productNature } = params
  const now = new Date().toISOString()

  const logger = createDeliveryLogger({ admin, integrationId, storeId, userId })

  // Recharger la commande
  const { data: order, error: orderError } = await admin
    .from('orders')
    .select(`
      id, store_id, status, city, address, phone, customer_name, total_selling_price,
      delivery_city_external_id, delivery_company_id, tracking_number, forcelog_parcel_key,
      order_items(quantity, products(name))
    `)
    .eq('id', orderId)
    .maybeSingle()

  if (orderError) throw orderError
  if (!order) return { trackingNumber: '', warning: 'Commande introuvable.' }

  if (order.forcelog_parcel_key || order.tracking_number) {
    logger.info('parcel-skip', 'Colis déjà existant', { trackingNumber: order.forcelog_parcel_key || order.tracking_number })
    return { trackingNumber: order.forcelog_parcel_key || order.tracking_number || '', warning: '' }
  }

  // Récupérer la config ForceLog
  const { data: config } = await admin
    .from('forcelog_configs')
    .select('*')
    .eq('store_id', storeId)
    .maybeSingle()

  // Normaliser la ville
  let cityValue = String(order.delivery_city_external_id || '').trim()
  let cityName = String(order.city || '').trim() || ''

  if (!cityValue) {
    const cityMatch = await normalizeOrderCityById(order.id, admin, 'forcelog')
    cityValue = cityMatch.cityKey || ''
    if (!cityValue && cityMatch.cityName) {
      cityName = cityMatch.cityName
    }
  }

  const forceLogCity = cityValue || cityName || 'Ville non spécifiée'

  if (!cityValue) {
    logger.warn('parcel-city-not-found', 'Ville non reconnue pour ForceLog', { orderId, city: order.city })
    return { trackingNumber: '', warning: 'Veuillez choisir une ville ForceLog dans le modal de confirmation.' }
  }

  // Résoudre les frais de livraison
  const deliveryFee = await resolveDeliveryFee({
    supabase: admin,
    storeId,
    cityKey: cityValue,
    integrationId,
    providerSlug: 'forcelog',
  })

  // Décrypter le token
  const apiKey = await getDecryptedIntegrationToken(admin, integrationId)

  // Préparer le payload
  const orderProductNames = (order.order_items || [])
    .map((item: any) => String(item?.products?.name || '').trim())
    .filter(Boolean)
    .join(', ')

  const resolvedProductNature = productNature || config?.default_product_nature || orderProductNames || 'Commande'

  logger.info('parcel-creating', 'Création colis ForceLog', {
    orderId,
    city: forceLogCity,
    productNature: resolvedProductNature,
  })

  const result = await createForceLogParcel(apiKey, {
    ORDER_NUM: String(order.id).slice(-20),
    RECEIVER: String(order.customer_name || 'Client').slice(0, 50),
    PHONE: normalizeForceLogPhone(order.phone || '').slice(0, 14),
    CITY: String(forceLogCity).slice(0, 50),
    ADDRESS: String(order.address || 'Adresse non spécifiée').slice(0, 100),
    COMMENT: deliveryNote ? String(deliveryNote).slice(0, 100) : undefined,
    PRODUCT_NATURE: resolvedProductNature.slice(0, 100),
    COD: Number(order.total_selling_price || 0),
    CAN_OPEN: canOpen !== undefined ? canOpen : (config?.default_can_open ?? true),
    FRAGILE: fragile !== undefined ? fragile : (config?.default_fragile ?? false),
    CARTON: config?.default_carton || undefined,
    STOCK: config?.default_stock || undefined,
  })

  if (result?.['ADD-PARCEL']?.RESULT === 'ERROR') {
    throw new Error(`FORCELOG_PARCEL_CREATE_FAILED:${result['ADD-PARCEL']?.MESSAGE || 'Unknown error'}`)
  }

  const trackingNumber = String(result?.['ADD-PARCEL']?.['NEW-PARCEL']?.TRACKING_NUMBER || '').trim()
  if (!trackingNumber) throw new Error('FORCELOG_NO_TRACKING_NUMBER')

  await admin.from('orders').update({
    tracking_number: trackingNumber,
    external_delivery_id: trackingNumber,
    forcelog_parcel_key: trackingNumber,
    forcelog_city_key: forceLogCity,
    delivery_city_external_id: cityValue || null,
    delivery_fee: deliveryFee || 0,
    delivery_status: 'pending',
    delivery_status_source: 'delivery_company',
    last_delivery_sync_at: now,
    updated_at: now,
  }).eq('id', orderId)

  logger.info('parcel-created', 'Colis ForceLog créé avec succès', { trackingNumber, deliveryFee })

  return { trackingNumber, warning: '' }
}
