import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { normalizeOrderCityById } from '@/lib/integrations/city-normalizer'
import { autoCreateRapidDeliveryParcelForOrder } from '@/lib/integrations/rapid-delivery-auto'
import { autoCreateOzoneParcelForOrder } from '@/lib/integrations/ozone-auto'
import { resolveDeliveryFee } from '@/lib/integrations/delivery/delivery-fee-resolver'

const STATUS_DATE_FIELD_MAP: Record<string, string> = {
  confirmation_rejected: 'confirmation_rejected_at',
  follow_up_1: 'follow_up_1_at',
  follow_up_2: 'follow_up_2_at',
  follow_up_3: 'follow_up_3_at',
  no_answer: 'no_answer_at',
  wrong_number: 'wrong_number_at',
  voicemail: 'voicemail_at',
  confirmed: 'confirmed_at',
  picked_up: 'picked_up_at',
  sent: 'sent_at',
  delivered: 'delivered_at',
  cancelled: 'cancelled_at',
  refused: 'refused_at',
  returned_not_stocked: 'returned_not_stocked_at',
  returned_stocked: 'returned_stocked_at',
  dl_no_answer: 'dl_no_answer_at',
  dl_unreachable: 'dl_unreachable_at',
  dl_out_of_zone: 'dl_out_of_zone_at',
  dl_client_interested: 'dl_client_interested_at',
  dl_postponed: 'dl_postponed_at',
  dl_address_change: 'dl_address_change_at',
  dl_pickup_pending: 'dl_pickup_pending_at',
  dl_refund: 'dl_refund_at',
  dl_follow_up_request: 'dl_follow_up_request_at',
  dl_billing_error: 'dl_billing_error_at',
  dl_out_for_delivery: 'dl_out_for_delivery_at',
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      orderId?: string
      status?: string
      deliveryNote?: string
      deliveryCompanyId?: string
      ozoneCityKey?: string | number
      ozoneCityName?: string
    }
    const orderId = String(body.orderId || '').trim()
    const status = String(body.status || '').trim()
    const deliveryNote = typeof body.deliveryNote === 'string' ? body.deliveryNote.trim() : ''
    const deliveryCompanyId = typeof body.deliveryCompanyId === 'string' ? body.deliveryCompanyId.trim() : ''
    const ozoneCityKey = Number(body.ozoneCityKey || 0) || 0
    const ozoneCityName = typeof body.ozoneCityName === 'string' ? body.ozoneCityName.trim() : ''

    if (!orderId || !status) {
      return NextResponse.json({ error: 'MISSING_REQUIRED_FIELDS' }, { status: 400 })
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        id, store_id, status, city, address, phone, customer_name, total_selling_price,
        delivery_city_external_id,
        delivery_company_id, tracking_number, delivery_status_source,
        order_items(quantity, products(name))
      `)
      .eq('id', orderId)
      .maybeSingle()

    if (orderError) throw orderError
    if (!order) {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }

    await verifyStoreAccess(supabase, user.id, order.store_id)

    const isDeliveryCompanyLocked = order.delivery_status_source === 'delivery_company'
    const isAllowedReturnedStockedOverride = order.status === 'returned_not_stocked' && status === 'returned_stocked'
    if (isDeliveryCompanyLocked && !isAllowedReturnedStockedOverride) {
      return NextResponse.json({ error: 'DELIVERY_COMPANY_STATUS_LOCKED' }, { status: 403 })
    }

    const now = new Date().toISOString()
    const updatePayload: Record<string, any> = {
      status,
      delivery_status_source: 'manual',
      updated_at: now,
      last_status_update_at: now,
    }

    if (deliveryNote) {
      updatePayload.delivery_note = deliveryNote
    }

    if (deliveryCompanyId) {
      updatePayload.delivery_company_id = deliveryCompanyId
    }

    const statusDateField = STATUS_DATE_FIELD_MAP[status]
    if (statusDateField) {
      updatePayload[statusDateField] = now
    }

    const { error: updateError } = await supabase.from('orders').update(updatePayload).eq('id', orderId)
    if (updateError) throw updateError

    let warning = ''
    let trackingNumber = String(order.tracking_number || '')

    const resolvedDeliveryCompanyId = deliveryCompanyId || order.delivery_company_id

    if (status === 'confirmed' && !trackingNumber && resolvedDeliveryCompanyId) {
      const admin = createAdminClient()
      const [{ data: deliveryCompany }, { data: integration }, { data: config }] = await Promise.all([
        supabase
          .from('delivery_companies')
          .select('id, name, api_provider')
          .eq('id', resolvedDeliveryCompanyId)
          .maybeSingle(),
        supabase
          .from('integrations')
          .select('id, status')
          .eq('user_id', user.id)
          .eq('provider', 'rapid-delivery')
          .maybeSingle(),
        supabase
          .from('rapid_delivery_configs')
          .select('default_shop_key, default_article_name, auto_change_status_to_picked_up, parcel_creation_mode')
          .eq('store_id', order.store_id)
          .maybeSingle(),
      ])

      const canAutoCreateRapid =
        (deliveryCompany?.api_provider === 'rapid-delivery' || String(deliveryCompany?.api_provider || '').trim() === '' && String((deliveryCompany as any)?.name || '').toLowerCase().includes('rapid')) &&
        integration?.status === 'connected' &&
        config?.parcel_creation_mode !== 'disabled'

      if (canAutoCreateRapid && config) {
        try {
          await normalizeOrderCityById(orderId, admin, 'rapid-delivery')
          // Recharger la commande pour avoir delivery_city_external_id à jour
          const { data: freshOrder } = await admin
            .from('orders')
            .select(`
              id, store_id, status, city, address, phone, customer_name, total_selling_price,
              delivery_city_external_id,
              delivery_company_id, tracking_number, delivery_status_source,
              order_items(quantity, products(name))
            `)
            .eq('id', orderId)
            .maybeSingle()
          const normalizedOrder = {
            ...(freshOrder || order),
            order_items: ((freshOrder || order).order_items || []).map((oi: any) => ({
              ...oi,
              products: Array.isArray(oi.products) ? (oi.products[0] ?? null) : oi.products,
            })),
          }
          const rapidCityKey = Number(normalizedOrder.delivery_city_external_id || 0) || 0
          if (rapidCityKey) {
            const rapidDeliveryFee = await resolveDeliveryFee({
              supabase: admin,
              storeId: order.store_id,
              cityKey: rapidCityKey,
              integrationId: integration.id,
              providerSlug: 'rapid-delivery',
            })

            await admin
              .from('orders')
              .update({ delivery_fee: rapidDeliveryFee, updated_at: now })
              .eq('id', orderId)
          }
          const result = await autoCreateRapidDeliveryParcelForOrder({
            admin,
            userId: user.id,
            integrationId: integration.id,
            order: normalizedOrder,
            defaultShopKey: Number(config.default_shop_key),
            defaultArticleName: config.default_article_name,
            deliveryNote: deliveryNote || undefined,
          })
          warning = result.warning
          trackingNumber = result.trackingNumber
        } catch (error) {
          warning = error instanceof Error ? error.message : 'AUTO_PARCEL_CREATE_FAILED'
        }
      }

      // OZONE auto-create
      if (!trackingNumber && deliveryCompany?.api_provider === 'ozone') {
        const [{ data: ozoneIntegration }] = await Promise.all([
          supabase
            .from('integrations')
            .select('id, status')
            .eq('user_id', user.id)
            .eq('provider', 'ozone')
            .maybeSingle(),
        ])

        if (ozoneIntegration?.status === 'connected') {
          try {
            if (!ozoneCityKey || !ozoneCityName) {
              warning = 'Veuillez choisir une ville OZONE dans le modal de confirmation.'
            } else {
              // Récupérer le coût de livraison pour cette ville OZONE
              const { data: ozoneRate } = await admin
                .from('delivery_rates')
                .select('price')
                .eq('provider_id', '5f806347-45f1-481a-901d-2eb98b20b3a8')
                .eq('external_city_key', String(ozoneCityKey))
                .maybeSingle()

              const ozoneDeliveryFee = ozoneRate?.price ? Number(ozoneRate.price) : 0

              const { error: ozoneCityUpdateError } = await admin
                .from('orders')
                .update({
                  city: ozoneCityName,
                  delivery_city_external_id: ozoneCityKey,
                  delivery_fee: ozoneDeliveryFee,
                  updated_at: now,
                })
                .eq('id', orderId)

              if (ozoneCityUpdateError) throw ozoneCityUpdateError
            }

            if (warning) {
              return NextResponse.json({ ok: true, warning, trackingNumber })
            }

            // Recharger la commande pour avoir delivery_city_external_id à jour
            const { data: freshOrder } = await admin
              .from('orders')
              .select(`
                id, store_id, status, city, address, phone, customer_name, total_selling_price,
                delivery_city_external_id,
                delivery_company_id, tracking_number, delivery_status_source,
                order_items(quantity, products(name))
              `)
              .eq('id', orderId)
              .maybeSingle()
            const normalizedOrder = {
              ...(freshOrder || order),
              order_items: ((freshOrder || order).order_items || []).map((oi: any) => ({
                ...oi,
                products: Array.isArray(oi.products) ? (oi.products[0] ?? null) : oi.products,
              })),
            }
            const result = await autoCreateOzoneParcelForOrder({
              admin,
              userId: user.id,
              integrationId: ozoneIntegration.id,
              order: normalizedOrder,
              deliveryNote: deliveryNote || undefined,
            })
            warning = result.warning
            trackingNumber = result.trackingNumber
          } catch (error) {
            warning = error instanceof Error ? error.message : 'OZONE_AUTO_PARCEL_CREATE_FAILED'
          }
        }
      }
    }

    return NextResponse.json({ ok: true, warning, trackingNumber })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ORDER_STATUS_UPDATE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
