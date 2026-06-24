// ============================================================
// Digylog Adapter — Création de colis, mapping statuts, etc.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { createDeliveryLogger } from './logger'
import * as digylog from '@/lib/integrations/digylog'
import { resolveDeliveryFee } from './delivery-fee-resolver'
import { normalizeOrderCityById } from '@/lib/integrations/city-normalizer'

type AdminClient = ReturnType<typeof createAdminClient>

export async function createDigylogParcelForOrder(params: {
  admin: AdminClient
  orderId: string
  storeId: string
  userId: string
  integrationId: string
  deliveryNote?: string
  networkId?: number
  orderMode?: 1 | 2
  sendStatus?: 0 | 1
  checkDuplicate?: 0 | 1
  openProduct?: 1 | 2
  port?: 1 | 2
  externalStore?: string
}) {
  const { admin, orderId, storeId, userId, integrationId } = params
  const logger = createDeliveryLogger({ admin, integrationId, storeId, userId })

  try {
    // 1. Récupérer la commande
    const { data: order, error: orderError } = await admin
      .from('orders')
      .select(`
        id, store_id, status, city, address, phone, customer_name, total_selling_price,
        delivery_city_external_id, delivery_note, delivery_company_id,
        tracking_number, external_delivery_id,
        order_items(quantity, products(name))
      `)
      .eq('id', orderId)
      .maybeSingle()

    if (orderError || !order) {
      throw new Error(orderError?.message || 'ORDER_NOT_FOUND')
    }

    // 2. Récupérer l'intégration + token
    const { data: integration } = await admin
      .from('integrations')
      .select('id, access_token, status')
      .eq('id', integrationId)
      .maybeSingle()

    if (!integration || integration.status !== 'connected' || !integration.access_token) {
      throw new Error('DIGYLOG_INTEGRATION_NOT_CONNECTED')
    }

    // 3. Récupérer la config Digylog
    const { data: config } = await admin
      .from('digylog_configs')
      .select('*')
      .eq('store_id', storeId)
      .maybeSingle()

    const networkId = params.networkId || config?.default_network_id || 2
    const orderMode = params.orderMode || (config?.default_order_mode as 1 | 2) || 1
    const sendStatus = params.sendStatus ?? (config?.default_send_status as 0 | 1) ?? 1
    const checkDuplicate = params.checkDuplicate ?? (config?.check_duplicate as 0 | 1) ?? 1
    const openProduct = params.openProduct || (config?.openproduct_default as 1 | 2) || 1
    const port = params.port || (config?.port_default as 1 | 2) || 2
    const externalStore = params.externalStore || config?.default_external_store || ''

    // 4. Résoudre la ville (Digylog attend le NOM de la ville, pas l'ID)
    let cityName = order.city || ''
    let cityKey = order.delivery_city_external_id
    if (!cityName || !cityKey) {
      const normalized = await normalizeOrderCityById(orderId, admin, 'digylog')
      cityName = normalized.cityName || cityName
      cityKey = normalized.cityKey || cityKey
    }
    if (!cityName) {
      throw new Error('DIGYLOG_MISSING_CITY_NAME')
    }

    // 5. Résoudre les frais de livraison
    const deliveryFee = await resolveDeliveryFee({
      supabase: admin,
      storeId,
      cityKey: String(cityKey),
      integrationId,
      providerSlug: 'digylog',
    })

    // 6. Construire les refs (produits)
    const refs: digylog.DigylogOrderRef[] = (order.order_items || []).map((oi: any) => ({
      ref: oi.products?.name ? undefined : undefined,
      designation: oi.products?.name || 'Produit',
      quantity: Number(oi.quantity) || 1,
    }))

    if (refs.length === 0) {
      refs.push({ designation: 'Produit', quantity: 1 })
    }

    // 7. Appel API Digylog
    const cfg: digylog.DigylogConfig = { token: integration.access_token, referer: 'https://apiseller.digylog.com' }
    const payload: digylog.DigylogCreateOrdersPayload = {
      mode: orderMode,
      network: networkId,
      store: externalStore || '',
      status: sendStatus,
      checkDuplicate,
      orders: [
        {
          num: orderId,
          type: 1,
          name: order.customer_name || 'Client',
          phone: order.phone || '',
          address: order.address || '',
          city: cityName,
          price: Number(order.total_selling_price) || 0,
          openproduct: openProduct,
          port,
          note: params.deliveryNote || order.delivery_note || undefined,
          refs,
        },
      ],
    }

    const raw = await digylog.createOrders(cfg, payload)

    // 8. Vérifier les erreurs métier Digylog (tableau avec isSuccess)
    let result: any = raw
    if (Array.isArray(raw)) {
      const failed = raw.find((r: any) => r.isSuccess === false)
      if (failed) {
        const errMsg = failed.errors?.join('; ') || 'Erreur inconnue'
        throw new Error(`DIGYLOG_ORDER_FAILED:${errMsg}`)
      }
      result = raw[0] || {}
    }

    // 9. Extraire le tracking number
    const trackingNumber = result?.tracking || result?.num || result?.orders?.[0]?.tracking || ''
    if (!trackingNumber) {
      throw new Error('DIGYLOG_NO_TRACKING_RETURNED')
    }

    // 9. Mettre à jour la commande
    const now = new Date().toISOString()
    const updateData: Record<string, any> = {
      tracking_number: trackingNumber || null,
      delivery_status_source: 'delivery_company',
      delivery_fee: deliveryFee,
      updated_at: now,
    }

    if (trackingNumber) {
      updateData.digylog_tracking = trackingNumber
    }

    const { error: updateError } = await admin
      .from('orders')
      .update(updateData)
      .eq('id', orderId)

    if (updateError) throw updateError

    logger.info('parcel-created', `Colis créé avec tracking ${trackingNumber || 'N/A'}`, {
      orderId,
      trackingNumber,
      networkId,
      cityKey,
    })

    return { trackingNumber, warning: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'DIGYLOG_PARCEL_CREATE_FAILED'
    logger.error('parcel-create-failed', message, { orderId })
    return { trackingNumber: '', warning: message }
  }
}

/**
 * Traite un webhook Digylog : met à jour le statut de la commande.
 */
export async function processDigylogWebhook(params: {
  admin: AdminClient
  integrationId: string
  storeId: string
  eventType: string
  eventKey?: string
  payload: any
}) {
  const { admin, integrationId, storeId, eventType, eventKey, payload } = params
  const logger = createDeliveryLogger({ admin, integrationId, storeId, userId: 'system' })

  try {
    // Vérifier l'idempotence
    if (eventKey) {
      const { data: existing } = await admin
        .from('digylog_webhook_events')
        .select('id, processed')
        .eq('event_key', eventKey)
        .maybeSingle()

      if (existing?.processed) {
        return { ok: true, skipped: true }
      }
    }

    // Insérer l'événement
    const { data: eventRecord, error: insertError } = await admin
      .from('digylog_webhook_events')
      .insert({
        integration_id: integrationId,
        store_id: storeId,
        event_type: eventType,
        event_key: eventKey || null,
        payload,
        processed: false,
      })
      .select('id')
      .single()

    if (insertError) throw insertError

    // Traiter selon le type d'événement
    if (eventType === 'order_status' || eventType === 'status') {
      const tracking = payload?.tracking || payload?.num || ''
      const statusLabel = payload?.status || payload?.statusLabel || ''
      const statusId = payload?.idStatus || payload?.statusId

      if (!tracking) {
        logger.warn('webhook-no-tracking', 'Événement sans tracking', { eventType })
        await admin.from('digylog_webhook_events').update({ processed: true, error: 'NO_TRACKING' }).eq('id', eventRecord.id)
        return { ok: true, skipped: true }
      }

      // Trouver la commande par tracking
      const { data: order } = await admin
        .from('orders')
        .select('id, status')
        .eq('store_id', storeId)
        .eq('tracking_number', tracking)
        .maybeSingle()

      if (!order) {
        logger.warn('webhook-order-not-found', `Commande ${tracking} introuvable`, { eventType })
        await admin.from('digylog_webhook_events').update({ processed: true, error: 'ORDER_NOT_FOUND' }).eq('id', eventRecord.id)
        return { ok: true, skipped: true }
      }

      // Mapper le statut
      const mapping = digylog.mapDigylogStatusToOrderStatus(statusLabel, statusId)
      if (mapping.orderStatus && mapping.orderStatus !== order.status) {
        const now = new Date().toISOString()
        const updateData: Record<string, any> = {
          status: mapping.orderStatus,
          delivery_status_source: 'delivery_company',
          updated_at: now,
          last_status_update_at: now,
        }
        if (mapping.statusDateField) {
          updateData[mapping.statusDateField] = now
        }

        await admin.from('orders').update(updateData).eq('id', order.id)
        logger.info('webhook-status-updated', `Statut mis à jour: ${order.status} → ${mapping.orderStatus}`, {
          tracking,
          oldStatus: order.status,
          newStatus: mapping.orderStatus,
        })
      }
    }

    // Marquer comme traité
    await admin.from('digylog_webhook_events').update({ processed: true, processed_at: new Date().toISOString() }).eq('id', eventRecord.id)

    return { ok: true, skipped: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'WEBHOOK_PROCESS_FAILED'
    logger.error('webhook-process-failed', message, { eventType, eventKey })
    return { ok: false, error: message }
  }
}
