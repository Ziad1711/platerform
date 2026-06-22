import { createAdminClient } from '@/lib/supabase/admin'
import { getSenditCredentials } from '@/lib/integrations/sendit-credentials'
import { resolveDeliveryFee } from '@/lib/integrations/delivery/delivery-fee-resolver'
import { createSenditParcel, getSenditLabels, mapSenditStatusToOrderStatus, normalizeSenditPhone, trackSenditParcel } from '@/lib/integrations/sendit'
import { createDeliveryLogger } from '@/lib/integrations/delivery/logger'
import type { DeliveryIntegrationConfig, ParcelCreationInput, VoucherCreationInput, CreateParcelResult, CreateVoucherResult, TrackParcelResult } from './types'
import type { DeliveryProvider } from './provider'

const SENDIT_PROVIDER_ID = '5998e563-96ed-47cc-881a-43f41827f858'

function extractCode(raw: unknown) {
  return String((raw as any)?.data?.code || (raw as any)?.code || '').trim()
}

export const senditAdapter: DeliveryProvider = {
  slug: 'sendit',
  async createParcel(config: DeliveryIntegrationConfig, input: ParcelCreationInput): Promise<CreateParcelResult> {
    const opts = (input.providerOptions || {}) as Record<string, any>
    const raw = await createSenditParcel(config.token, {
      pickup_district_id: opts.pickupDistrictId ? String(opts.pickupDistrictId) : undefined,
      district_id: input.cityKey,
      name: String(input.recipient || 'Client').slice(0, 100),
      amount: Number(input.price || 0),
      address: String(input.address || 'Adresse non spécifiée').slice(0, 200),
      phone: normalizeSenditPhone(input.phone),
      comment: input.remark ? String(input.remark).slice(0, 500) : undefined,
      reference: opts.reference ? String(opts.reference).slice(0, 100) : undefined,
      allow_open: opts.allowOpen === false ? 0 : 1,
      allow_try: opts.allowTry === false ? 0 : 1,
      products_from_stock: opts.productsFromStock ? 1 : 0,
      products: opts.products ? String(opts.products) : input.articleName,
      packaging_id: opts.packagingId ? String(opts.packagingId) : undefined,
      option_exchange: opts.optionExchange ? 1 : 0,
      delivery_exchange_id: opts.deliveryExchangeId ? String(opts.deliveryExchangeId) : undefined,
    })
    if ((raw as any)?.success === false) throw new Error(`SENDIT_PARCEL_CREATE_FAILED:${(raw as any)?.message || ''}`)
    const code = extractCode(raw)
    if (!code) throw new Error(`SENDIT_NO_PARCEL_CODE:${JSON.stringify(raw).slice(0, 500)}`)
    return { providerId: code, raw }
  },
  async createVoucher(config: DeliveryIntegrationConfig, input: VoucherCreationInput): Promise<CreateVoucherResult> {
    const raw = await getSenditLabels(config.token, input.parcelKeys.map(String), Number((input as any).printFormat || 1))
    return { providerVoucherKey: String((raw as any)?.data?.fileUrl || `sendit_labels_${Date.now()}`), totalParcels: input.parcelKeys.length, raw }
  },
  async trackParcel(config: DeliveryIntegrationConfig, trackingNumber: string): Promise<TrackParcelResult> {
    const raw = await trackSenditParcel(config.token, trackingNumber)
    const rawStatus = String((raw as any)?.data?.status || '')
    const mapped = mapSenditStatusToOrderStatus(rawStatus)
    return { rawStatus, orderStatus: mapped.orderStatus, deliveryStatus: mapped.deliveryStatus, statusDateField: mapped.statusDateField, raw }
  },
  async getVoucher(_config: DeliveryIntegrationConfig, voucherKey: string) { return { key: voucherKey, provider: 'sendit' } },
  async downloadLabel(config: DeliveryIntegrationConfig, path: string) {
    const codes = path.split(',').map((x) => x.trim()).filter(Boolean)
    const raw = await getSenditLabels(config.token, codes, 1)
    const url = String((raw as any)?.data?.fileUrl || '')
    if (!url) throw new Error('SENDIT_LABEL_URL_NOT_FOUND')
    return { body: new TextEncoder().encode(url).buffer as ArrayBuffer, contentType: 'text/plain; charset=utf-8', contentDisposition: 'inline', byteLength: url.length }
  },
}

export async function createSenditParcelForOrder(params: {
  admin: ReturnType<typeof createAdminClient>
  orderId: string
  storeId: string
  userId: string
  integrationId: string
  deliveryNote?: string
  districtId?: string
  districtName?: string
  allowOpen?: boolean
  allowTry?: boolean
  productsFromStock?: boolean
  packagingId?: string
  optionExchange?: boolean
  deliveryExchangeId?: string
  pickupDistrictId?: string
}) {
  const { admin, orderId, storeId, userId, integrationId } = params
  const now = new Date().toISOString()
  const logger = createDeliveryLogger({ admin, integrationId, storeId, userId })
  const { data: order, error } = await admin.from('orders').select('id, store_id, city, address, phone, customer_name, total_selling_price, delivery_city_external_id, sendit_parcel_code, tracking_number, order_items(quantity, products(name))').eq('id', orderId).maybeSingle()
  if (error) throw error
  if (!order) {
    logger.warn('parcel-order-not-found', 'Commande introuvable pour création colis Sendit', { orderId })
    return { trackingNumber: '', warning: 'Commande introuvable.' }
  }
  if (order.sendit_parcel_code || order.tracking_number) {
    logger.info('parcel-already-exists', 'Colis Sendit déjà existant', { code: order.sendit_parcel_code || order.tracking_number })
    return { trackingNumber: order.sendit_parcel_code || order.tracking_number || '', warning: '' }
  }
  const district = String(params.districtId || order.delivery_city_external_id || '').trim()
  if (!district) {
    logger.warn('parcel-no-district', 'Aucune ville Sendit sélectionnée', { orderId })
    return { trackingNumber: '', warning: 'Veuillez choisir une ville Sendit dans le modal de confirmation.' }
  }
  logger.info('parcel-creating', 'Création colis Sendit', { orderId, district, amount: order.total_selling_price })
  const credentials = await getSenditCredentials(admin, integrationId)
  const { data: cfg } = await admin.from('sendit_configs').select('*').eq('store_id', storeId).maybeSingle()
  const products = (order.order_items || []).map((i: any) => `${i?.products?.name || 'Produit'} x${i?.quantity || 1}`).join(', ')
  const deliveryFee = await resolveDeliveryFee({ supabase: admin, storeId, cityKey: district, integrationId, providerSlug: 'sendit' })
  logger.info('parcel-calling-api', 'Appel API Sendit', { district, amount: order.total_selling_price })
  const raw = await createSenditParcel(credentials.token, {
    pickup_district_id: params.pickupDistrictId || cfg?.default_pickup_district_id || district || undefined,

    district_id: district,
    name: String(order.customer_name || 'Client').slice(0, 100),
    amount: Number(order.total_selling_price || 0),
    address: String(order.address || 'Adresse non spécifiée').slice(0, 200),
    phone: normalizeSenditPhone(order.phone || ''),
    comment: params.deliveryNote || undefined,
    reference: String(order.id).slice(0, 50),
    allow_open: params.allowOpen ?? cfg?.default_allow_open !== false ? 1 : 0,
    allow_try: params.allowTry ?? cfg?.default_allow_try !== false ? 1 : 0,
    products_from_stock: params.productsFromStock ?? cfg?.default_products_from_stock ? 1 : 0,
    products,
    packaging_id: params.packagingId || cfg?.default_packaging_id || undefined,
    option_exchange: params.optionExchange ?? cfg?.default_option_exchange ? 1 : 0,
    delivery_exchange_id: params.deliveryExchangeId || cfg?.default_delivery_exchange_id || undefined,
  })
  const code = extractCode(raw)
  if (!code) {
    logger.error('parcel-no-code', 'Aucun code retourné par Sendit', { raw: JSON.stringify(raw).slice(0, 500) })
    throw new Error(`SENDIT_NO_PARCEL_CODE:${JSON.stringify(raw).slice(0, 500)}`)
  }
  logger.info('parcel-created', 'Colis Sendit créé avec succès', { code, deliveryFee })
  await admin.from('orders').update({ tracking_number: code, external_delivery_id: code, sendit_parcel_code: code, sendit_district_id: district, sendit_label_url: (raw as any)?.data?.labelUrl || null, delivery_city_external_id: district, delivery_fee: deliveryFee || 0, delivery_status: 'pending', delivery_status_source: 'delivery_company', last_delivery_sync_at: now, updated_at: now }).eq('id', orderId)
  await admin.from('delivery_entity_mappings').upsert({ provider_id: SENDIT_PROVIDER_ID, user_id: userId, integration_id: integrationId, store_id: storeId, entity_type: 'parcel', provider_entity_id: code, internal_id: orderId, payload: { raw, provider_slug: 'sendit' }, updated_at: now }, { onConflict: 'integration_id,entity_type,provider_entity_id' })
  logger.info('parcel-saved', 'Colis Sendit enregistré en base', { code })
  return { trackingNumber: code, warning: '' }

}