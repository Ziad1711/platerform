import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { normalizeOrderCityById } from '@/lib/integrations/city-normalizer'
import { resolveStoreIntegration } from '@/lib/integrations/delivery/resolve-store-integration'
import { autoCreateRapidDeliveryParcelForOrder } from '@/lib/integrations/rapid-delivery-auto'
import { autoCreateMarocGoDeliveryParcelForOrder } from '@/lib/integrations/maroc-go-delivery-auto'
import { autoCreateOzoneParcelForOrder } from '@/lib/integrations/ozone-auto'
import { resolveDeliveryFee } from '@/lib/integrations/delivery/delivery-fee-resolver'
import { createForceLogParcelForOrder } from '@/lib/integrations/delivery/forcelog-adapter'
import { createSenditParcelForOrder } from '@/lib/integrations/delivery/sendit-adapter'
import { createDigylogParcelForOrder } from '@/lib/integrations/delivery/digylog-adapter'

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
      deliveryMode?: 'internal' | 'shipping'
      ozoneCityKey?: string | number
      ozoneCityName?: string
      ozoneParcelOpen?: 1 | 2
      ozoneParcelFragile?: 0 | 1
      ozoneParcelReplace?: 0 | 1
      forcelogCanOpen?: boolean
      forcelogFragile?: boolean
      forcelogProductNature?: string
      ameexCityKey?: string
      ameexCityName?: string
      ameexParcelType?: string
      ameexOpen?: boolean
      ameexFragile?: boolean
      ameexReplace?: boolean
      ameexTry?: boolean
      senditCityKey?: string
      senditCityName?: string
      senditAllowOpen?: boolean
      senditAllowTry?: boolean
      senditProductsFromStock?: boolean
      senditPackagingId?: string
      senditOptionExchange?: boolean
      senditDeliveryExchangeId?: string
      senditPickupDistrictId?: string
      digylogNetworkId?: string | number
      digylogExternalStore?: string
      digylogOrderMode?: 1 | 2
      digylogSendStatus?: 0 | 1
      digylogCheckDuplicate?: 0 | 1
      digylogOpenProduct?: 1 | 2
      digylogPort?: 1 | 2
    }
    const orderId = String(body.orderId || '').trim()
    const status = String(body.status || '').trim()
    const deliveryNote = typeof body.deliveryNote === 'string' ? body.deliveryNote.trim() : ''
    const deliveryCompanyId = typeof body.deliveryCompanyId === 'string' ? body.deliveryCompanyId.trim() : ''
    // « Livraison interne » : aucun transporteur externe ne doit être utilisé et
    // aucun colis ne doit être créé automatiquement.
    const isInternalDelivery = body.deliveryMode === 'internal'
    const ozoneCityKey = Number(body.ozoneCityKey || 0) || 0
    const ozoneCityName = typeof body.ozoneCityName === 'string' ? body.ozoneCityName.trim() : ''
    const ozoneParcelOptions = {
      open: body.ozoneParcelOpen === 2 ? 2 as const : 1 as const,
      fragile: body.ozoneParcelFragile === 1 ? 1 as const : 0 as const,
      replace: body.ozoneParcelReplace === 1 ? 1 as const : 0 as const,
    }

    if (!orderId || !status) {
      return NextResponse.json({ error: 'MISSING_REQUIRED_FIELDS' }, { status: 400 })
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        id, store_id, status, city, address, phone, customer_name, total_selling_price,
        delivery_city_external_id,
        delivery_company_id, tracking_number, delivery_status_source,
        order_items(quantity, product_name_override, products(name))
      `)
      .eq('id', orderId)
      .maybeSingle()

    if (orderError) throw orderError
    if (!order) {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }

    await verifyStoreAccess(supabase, user.id, order.store_id)

    // Le statut reste toujours corrigeable manuellement, même pour une commande
    // suivie par un transporteur (rattrapage d'une erreur de statut) : le client
    // affiche un avertissement de confirmation avant d'envoyer la modification.
    const now = new Date().toISOString()
    const updatePayload: Record<string, any> = {
      status,
      updated_at: now,
      last_status_update_at: now,
      // La modification manuelle reprend la main pour ne pas être écrasée
      // par une prochaine synchro du transporteur.
      delivery_status_source: 'manual',
    }

    if (deliveryNote) {
      updatePayload.delivery_note = deliveryNote
    }

    if (isInternalDelivery) {
      // Livraison assurée en interne : on détache toute société externe.
      updatePayload.delivery_company_id = null
    } else if (deliveryCompanyId) {
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

    // En livraison interne, on ne retombe jamais sur l'ancienne société.
    const resolvedDeliveryCompanyId = isInternalDelivery
      ? null
      : (deliveryCompanyId || order.delivery_company_id)

    if (status === 'confirmed' && !trackingNumber && resolvedDeliveryCompanyId) {
      const admin = createAdminClient()
      const [{ data: deliveryCompany }, integration] = await Promise.all([
        supabase
          .from('delivery_companies')
          .select('id, name, api_provider')
          .eq('id', resolvedDeliveryCompanyId)
          .maybeSingle(),
        resolveStoreIntegration(supabase, 'rapid-delivery', order.store_id),
      ])

      let config: {
        default_shop_key: number | string | null
        default_article_name: string | null
        auto_change_status_to_picked_up: boolean | null
        parcel_creation_mode: string | null
      } | null = null

      if (integration?.id) {
        const { data: storeConfig, error: storeConfigError } = await supabase
          .from('rapid_delivery_configs')
          .select('default_shop_key, default_article_name, auto_change_status_to_picked_up, parcel_creation_mode')
          .eq('store_id', order.store_id)
          .maybeSingle()

        if (storeConfigError) throw storeConfigError
        config = storeConfig

        if (!config) {
          const { data: integrationConfig, error: integrationConfigError } = await supabase
            .from('rapid_delivery_configs')
            .select('default_shop_key, default_article_name, auto_change_status_to_picked_up, parcel_creation_mode')
            .eq('integration_id', integration.id)
            .maybeSingle()

          if (integrationConfigError) throw integrationConfigError
          config = integrationConfig
        }
      }

      const canAutoCreateRapid =
        (deliveryCompany?.api_provider === 'rapid-delivery' || String(deliveryCompany?.api_provider || '').trim() === '' && String((deliveryCompany as any)?.name || '').toLowerCase().includes('rapid')) &&
        integration?.status === 'connected' &&
        config?.parcel_creation_mode !== 'disabled'

      if (canAutoCreateRapid && integration?.id) {
        try {
          await normalizeOrderCityById(orderId, admin, 'rapid-delivery')
          // Recharger la commande pour avoir delivery_city_external_id à jour
          const { data: freshOrder } = await admin
            .from('orders')
            .select(`
              id, store_id, status, city, address, phone, customer_name, total_selling_price,
              delivery_city_external_id,
              delivery_company_id, tracking_number, delivery_status_source,
              order_items(quantity, product_name_override, products(name))
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
            defaultShopKey: Number(config?.default_shop_key || 0),
            defaultArticleName: config?.default_article_name,
            deliveryNote: deliveryNote || undefined,
          })
          warning = result.warning
          trackingNumber = result.trackingNumber
        } catch (error) {
          warning = error instanceof Error ? error.message : 'AUTO_PARCEL_CREATE_FAILED'
          console.error('Rapid Delivery auto parcel creation failed', {
            orderId,
            storeId: order.store_id,
            integrationId: integration.id,
            error: warning,
          })
        }
      }

      // Maroc Go Delivery auto-create
      if (!trackingNumber && deliveryCompany?.api_provider === 'maroc-go-delivery') {
        const marocGoIntegration = await resolveStoreIntegration(
          supabase,
          'maroc-go-delivery',
          order.store_id
        )

        const { data: marocGoConfig, error: marocGoConfigError } = await supabase
          .from('maroc_go_delivery_configs')
          .select('default_shop_key, default_article_name, auto_change_status_to_picked_up, parcel_creation_mode')
          .eq('store_id', order.store_id)
          .maybeSingle()

        if (marocGoConfigError) throw marocGoConfigError

        const canAutoCreateMarocGo =
          marocGoIntegration?.status === 'connected' &&
          marocGoConfig?.parcel_creation_mode !== 'disabled'

        if (canAutoCreateMarocGo && marocGoIntegration?.id && marocGoConfig) {
          try {
            await normalizeOrderCityById(orderId, admin, 'maroc-go-delivery')
            // Recharger la commande pour avoir delivery_city_external_id à jour
            const { data: freshOrder } = await admin
              .from('orders')
              .select(`
                id, store_id, status, city, address, phone, customer_name, total_selling_price,
                delivery_city_external_id,
                delivery_company_id, tracking_number, delivery_status_source,
                order_items(quantity, product_name_override, products(name))
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
            const marocGoCityKey = Number(normalizedOrder.delivery_city_external_id || 0) || 0
            if (marocGoCityKey) {
              const marocGoDeliveryFee = await resolveDeliveryFee({
                supabase: admin,
                storeId: order.store_id,
                cityKey: marocGoCityKey,
                integrationId: marocGoIntegration.id,
                providerSlug: 'maroc-go-delivery',
              })

              await admin
                .from('orders')
                .update({ delivery_fee: marocGoDeliveryFee, updated_at: now })
                .eq('id', orderId)
            }
            const result = await autoCreateMarocGoDeliveryParcelForOrder({
              admin,
              userId: user.id,
              integrationId: marocGoIntegration.id,
              order: normalizedOrder,
              defaultShopKey: Number(marocGoConfig.default_shop_key || 0),
              defaultArticleName: marocGoConfig.default_article_name,
              deliveryNote: deliveryNote || undefined,
            })
            warning = result.warning
            trackingNumber = result.trackingNumber
          } catch (error) {
            warning = error instanceof Error ? error.message : 'MAROC_GO_DELIVERY_AUTO_PARCEL_CREATE_FAILED'
            console.error('Maroc Go Delivery auto parcel creation failed', {
              orderId,
              storeId: order.store_id,
              integrationId: marocGoIntegration.id,
              error: warning,
            })
          }
        }
      }

      // ForceLog auto-create
      if (!trackingNumber && deliveryCompany?.api_provider === 'forcelog') {
        const flIntegration = await resolveStoreIntegration(supabase, 'forcelog', order.store_id)

        if (flIntegration?.status === 'connected') {
          try {
            const result = await createForceLogParcelForOrder({
              admin,
              orderId,
              storeId: order.store_id,
              userId: user.id,
              integrationId: flIntegration.id,
              deliveryNote: deliveryNote || undefined,
              canOpen: body.forcelogCanOpen,
              fragile: body.forcelogFragile,
              productNature: body.forcelogProductNature,
            })
            warning = result.warning
            trackingNumber = result.trackingNumber
          } catch (error) {
            warning = error instanceof Error ? error.message : 'FORCELOG_AUTO_PARCEL_CREATE_FAILED'
          }
        }

        if (!flIntegration && deliveryCompany?.api_provider === 'forcelog') {
          warning = 'Intégration ForceLog non connectée pour ce store.'
        }
      }

      // OZONE auto-create
      if (!trackingNumber && deliveryCompany?.api_provider === 'ozone') {
        const ozoneIntegration = await resolveStoreIntegration(supabase, 'ozone', order.store_id)

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
                order_items(quantity, product_name_override, products(name))
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
              parcelOptions: ozoneParcelOptions,
            })
            warning = result.warning
            trackingNumber = result.trackingNumber
          } catch (error) {
            warning = error instanceof Error ? error.message : 'OZONE_AUTO_PARCEL_CREATE_FAILED'
          }
        }

        if (!ozoneIntegration && deliveryCompany?.api_provider === 'ozone') {
          warning = 'Intégration OZONE non connectée pour ce store.'
        }
      }

      // Sendit auto-create
      if (!trackingNumber && deliveryCompany?.api_provider === 'sendit') {
        const senditIntegration = await resolveStoreIntegration(supabase, 'sendit', order.store_id)

        if (senditIntegration?.status === 'connected') {
          try {
            const senditCityKey = body.senditCityKey || ''
            const senditCityName = body.senditCityName || ''

            if (senditCityKey && senditCityName) {
              const { data: senditRate } = await admin
                .from('delivery_rates')
                .select('price')
                .eq('provider_id', '5998e563-96ed-47cc-881a-43f41827f858')
                .eq('external_city_key', String(senditCityKey))
                .maybeSingle()

              const senditDeliveryFee = senditRate?.price ? Number(senditRate.price) : 0

              const { error: senditCityUpdateError } = await admin
                .from('orders')
                .update({
                  city: senditCityName,
                  delivery_city_external_id: Number(senditCityKey) || null,
                  delivery_fee: senditDeliveryFee,
                  updated_at: now,
                })
                .eq('id', orderId)

              if (senditCityUpdateError) throw senditCityUpdateError
            }

            const result = await createSenditParcelForOrder({
              admin,
              orderId,
              storeId: order.store_id,
              userId: user.id,
              integrationId: senditIntegration.id,
              deliveryNote: deliveryNote || undefined,
              allowOpen: body.senditAllowOpen,
              allowTry: body.senditAllowTry,
              productsFromStock: body.senditProductsFromStock,
              packagingId: body.senditPackagingId,
              optionExchange: body.senditOptionExchange,
              deliveryExchangeId: body.senditDeliveryExchangeId,
              pickupDistrictId: body.senditPickupDistrictId,
            })
            warning = result.warning
            trackingNumber = result.trackingNumber
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : 'SENDIT_AUTO_PARCEL_CREATE_FAILED'
            try {
              const { createDeliveryLogger } = await import('@/lib/integrations/delivery/logger')
              const errLogger = createDeliveryLogger({ admin, integrationId: senditIntegration.id, storeId: order.store_id, userId: user.id })
              errLogger.error('parcel-create-failed', errMsg, { orderId })
            } catch {}
            warning = errMsg
          }

        }

        if (!senditIntegration && deliveryCompany?.api_provider === 'sendit') {
          warning = 'Intégration Sendit non connectée pour ce store.'
        }
      }

      // AMEEX auto-create
      if (!trackingNumber && deliveryCompany?.api_provider === 'ameex') {
        const ameexIntegration = await resolveStoreIntegration(supabase, 'ameex', order.store_id)

        if (ameexIntegration?.status === 'connected') {
          try {
            const ameexCityKey = body.ameexCityKey || ''
            const ameexCityName = body.ameexCityName || ''

            if (ameexCityKey && ameexCityName) {
              // Récupérer le coût de livraison pour cette ville AMEEX
              const { data: ameexRate } = await admin
                .from('delivery_rates')
                .select('price')
                .eq('provider_id', '729e93ed-207f-4281-8ef6-de37006993de')
                .eq('external_city_key', String(ameexCityKey))
                .maybeSingle()

              const ameexDeliveryFee = ameexRate?.price ? Number(ameexRate.price) : 0

              const { error: ameexCityUpdateError } = await admin
                .from('orders')
                .update({
                  city: ameexCityName,
                  delivery_city_external_id: Number(ameexCityKey) || null,
                  ameex_city_key: String(ameexCityKey),
                  delivery_fee: ameexDeliveryFee,
                  updated_at: now,
                })
                .eq('id', orderId)

              if (ameexCityUpdateError) throw ameexCityUpdateError
            }

            const { createAmeexParcelForOrder } = await import('@/lib/integrations/delivery/ameex-adapter')
            const result = await createAmeexParcelForOrder({
              admin,
              orderId,
              storeId: order.store_id,
              userId: user.id,
              integrationId: ameexIntegration.id,
              deliveryNote: deliveryNote || undefined,
              parcelType: body.ameexParcelType,
              canOpen: body.ameexOpen,
              fragile: body.ameexFragile,
              replace: body.ameexReplace,
              tryEnabled: body.ameexTry,
            })
            warning = result.warning
            trackingNumber = result.trackingNumber
          } catch (error) {
            warning = error instanceof Error ? error.message : 'AMEEX_AUTO_PARCEL_CREATE_FAILED'
          }
        }

        if (!ameexIntegration && deliveryCompany?.api_provider === 'ameex') {
          warning = 'Intégration AMEEX non connectée pour ce store.'
        }
      }

      // Digylog auto-create
      if (!trackingNumber && deliveryCompany?.api_provider === 'digylog') {
        const digylogIntegration = await resolveStoreIntegration(
          supabase,
          'digylog',
          order.store_id
        )

        if (digylogIntegration?.status === 'connected') {
          try {
            const normalized = await normalizeOrderCityById(orderId, admin, 'digylog')
            if (normalized.cityKey) {
              const deliveryFee = await resolveDeliveryFee({
                supabase: admin,
                storeId: order.store_id,
                cityKey: String(normalized.cityKey),
                integrationId: digylogIntegration.id,
                providerSlug: 'digylog',
              })

              await admin
                .from('orders')
                .update({ delivery_fee: deliveryFee, updated_at: now })
                .eq('id', orderId)
            }

            const result = await createDigylogParcelForOrder({
              admin,
              orderId,
              storeId: order.store_id,
              userId: user.id,
              integrationId: digylogIntegration.id,
              deliveryNote: deliveryNote || undefined,
              networkId: Number(body.digylogNetworkId || 0) || undefined,
              externalStore: body.digylogExternalStore,
              orderMode: body.digylogOrderMode,
              sendStatus: body.digylogSendStatus,
              checkDuplicate: body.digylogCheckDuplicate,
              openProduct: body.digylogOpenProduct,
              port: body.digylogPort,
            })
            warning = result.warning
            trackingNumber = result.trackingNumber
          } catch (error) {
            warning = error instanceof Error ? error.message : 'DIGYLOG_AUTO_PARCEL_CREATE_FAILED'
          }
        }

        if (!digylogIntegration && deliveryCompany?.api_provider === 'digylog') {
          warning = 'Intégration Digylog non connectée pour ce store.'
        }
      }
    }

    return NextResponse.json({ ok: true, warning, trackingNumber })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ORDER_STATUS_UPDATE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
