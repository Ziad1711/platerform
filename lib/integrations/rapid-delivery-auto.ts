import type { SupabaseClient } from '@supabase/supabase-js'
import { createDeliveryLogger } from '@/lib/integrations/delivery/logger'
import { rapidDeliveryAdapter } from '@/lib/integrations/delivery/rapid-delivery-adapter'
import { createParcelForOrder } from '@/lib/integrations/delivery/parcel-service'
import { getRapidDeliveryIntegrationCredentials } from '@/lib/integrations/rapid-delivery-connect'

type AdminClient = SupabaseClient<any, 'public', any>

type OrderLike = {
  id: string
  store_id: string
  city?: string | null
  address?: string | null
  phone?: string | null
  customer_name?: string | null
  total_selling_price?: number | string | null
  tracking_number?: string | null
  rapid_delivery_city_key?: number | string | null
  rapid_delivery_parcel_key?: string | null
  order_items?: Array<{ products?: { name?: string | null } | null }> | null
}

export async function autoCreateRapidDeliveryParcelForOrder(params: {
  admin: AdminClient
  userId: string
  integrationId: string
  order: OrderLike
  defaultShopKey: number
  defaultArticleName?: string | null
}) {
  const { admin, userId, integrationId, order, defaultShopKey, defaultArticleName } = params

  const { token, baseUrl } = await getRapidDeliveryIntegrationCredentials(admin, integrationId)

  const logger = createDeliveryLogger({
    admin,
    integrationId,
    storeId: order.store_id,
    userId,
  })

  const config = {
    integrationId,
    token,
    baseUrl,
    userId,
    storeId: order.store_id,
  }

  const result = await createParcelForOrder({
    admin,
    provider: rapidDeliveryAdapter,
    config,
    order: {
      id: order.id,
      storeId: order.store_id,
      city: order.city,
      address: order.address,
      phone: order.phone,
      customerName: order.customer_name,
      totalSellingPrice: order.total_selling_price,
      trackingNumber: order.tracking_number,
      rapidDeliveryCityKey: order.rapid_delivery_city_key,
      rapidDeliveryParcelKey: order.rapid_delivery_parcel_key,
      orderItems: (order.order_items || []).map((item) => ({
        productName: item?.products?.name || null,
      })),
    },
    defaultShopKey,
    defaultArticleName,
    logger,
  })

  return result
}
