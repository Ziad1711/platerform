import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { hasPermission } from '@/lib/auth/permissions'
import type { Role } from '@/lib/auth/permissions'
import {
  EXCHANGE_RETURN_ORDER_STATUS,
  EXCHANGE_STATUS_COMPLETED,
  EXCHANGE_STATUS_LINKED,
  EXCHANGE_STATUS_REQUESTED,
  isExchangeActive,
  isExchangeSupportedProvider,
} from '@/lib/integrations/delivery/exchange-providers'
import {
  createExchangeReplacementOrder,
  getOriginalParcelKey,
  trackExchangeParcel,
  type ExchangeCarrierState,
} from '@/lib/integrations/delivery/exchange-service'

/**
 * Demande d'échange d'un colis livré.
 * Rapid Delivery et Maroc Go Delivery n'ont pas d'API d'échange : l'utilisateur
 * fait la demande sur leur plateforme puis colle ici le nouvel ID de colis.
 */
export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as { orderId?: string; newParcelKey?: string }
    const orderId = String(body.orderId || '').trim()
    const newParcelKey = String(body.newParcelKey || '').trim()

    if (!orderId || !newParcelKey) {
      return NextResponse.json({ error: 'MISSING_REQUIRED_FIELDS' }, { status: 400 })
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        id, store_id, status, customer_name, phone, address, city,
        total_selling_price, delivery_fee, delivery_charge_to_customer,
        discount_type, discount_value, discount_amount, subtotal_amount,
        source, delivery_company_id, confirmation_agent_id,
        delivery_city_external_id, tracking_number,
        rapid_delivery_parcel_key, maroc_go_delivery_parcel_key,
        exchange_status, exchange_new_parcel_key, exchange_original_order_id,
        delivery_companies(api_provider)
      `)
      .eq('id', orderId)
      .maybeSingle()

    if (orderError) throw orderError
    if (!order) {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }

    const membership = await verifyStoreAccess(supabase, user.id, order.store_id)
    const role = membership.role as Role
    if (!hasPermission(role, 'sales.write') && !hasPermission(role, 'delivery.manage')) {
      return NextResponse.json({ error: 'EXCHANGE_FORBIDDEN' }, { status: 403 })
    }

    const providerSlug = String((order as any)?.delivery_companies?.api_provider || '').trim()
    if (!isExchangeSupportedProvider(providerSlug)) {
      return NextResponse.json({ error: 'EXCHANGE_NOT_SUPPORTED_FOR_PROVIDER' }, { status: 400 })
    }

    const exchangeStatus = String((order as any).exchange_status || '')

    if ((order as any).exchange_original_order_id) {
      return NextResponse.json({ error: 'EXCHANGE_NOT_ALLOWED_ON_REPLACEMENT' }, { status: 400 })
    }

    // Reprise : un échange enregistré dont la commande de remplacement n'a pas pu
    // être créée peut être relancé avec le même nouvel ID de colis.
    const isResumingRequest =
      exchangeStatus === EXCHANGE_STATUS_REQUESTED &&
      String((order as any).exchange_new_parcel_key || '').trim() === newParcelKey

    if (!isResumingRequest && String(order.status || '') !== 'delivered') {
      return NextResponse.json({ error: 'EXCHANGE_REQUIRES_DELIVERED_ORDER' }, { status: 400 })
    }

    if (!isResumingRequest && (isExchangeActive(exchangeStatus) || exchangeStatus === EXCHANGE_STATUS_COMPLETED)) {
      return NextResponse.json({ error: 'EXCHANGE_ALREADY_LINKED' }, { status: 409 })
    }

    const originalParcelKey = getOriginalParcelKey(order as Record<string, any>, providerSlug)
    if (originalParcelKey && originalParcelKey === newParcelKey) {
      return NextResponse.json({ error: 'EXCHANGE_SAME_PARCEL_KEY' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('provider', providerSlug)
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration || integration.status !== 'connected') {
      return NextResponse.json({ error: 'DELIVERY_INTEGRATION_NOT_CONNECTED' }, { status: 400 })
    }

    // 1. Vérifier le nouvel ID chez le transporteur (il doit exister).
    let newCarrierState: ExchangeCarrierState
    try {
      newCarrierState = await trackExchangeParcel({
        admin,
        integrationId: integration.id,
        providerSlug,
        parcelKey: newParcelKey,
      })
    } catch (error) {
      return NextResponse.json(
        {
          error: 'EXCHANGE_NEW_PARCEL_NOT_FOUND',
          details: error instanceof Error ? error.message : '',
        },
        { status: 400 },
      )
    }

    // 2. Suivre l'ANCIEN colis : c'est lui qui doit basculer sur
    //    « Retour/Echange », pas le nouveau.
    let originalCarrierState: ExchangeCarrierState | null = null
    if (originalParcelKey) {
      try {
        originalCarrierState = await trackExchangeParcel({
          admin,
          integrationId: integration.id,
          providerSlug,
          parcelKey: originalParcelKey,
        })
      } catch (error) {
        console.warn('Exchange original parcel tracking failed', {
          orderId: order.id,
          originalParcelKey,
          error: error instanceof Error ? error.message : error,
        })
      }
    }

    const returnConfirmed = originalCarrierState?.orderStatus === EXCHANGE_RETURN_ORDER_STATUS
    const now = new Date().toISOString()

    // 3. Enregistrer la demande d'échange sur la commande d'origine.
    const originalUpdate: Record<string, any> = {
      exchange_status: EXCHANGE_STATUS_REQUESTED,
      exchange_new_parcel_key: newParcelKey,
      updated_at: now,
    }

    // On conserve la date de la demande initiale lors d'une reprise.
    if (!isResumingRequest) {
      originalUpdate.exchange_requested_at = now
    }

    if (returnConfirmed && order.status !== EXCHANGE_RETURN_ORDER_STATUS) {
      originalUpdate.status = EXCHANGE_RETURN_ORDER_STATUS
      originalUpdate.delivery_status = originalCarrierState?.deliveryStatus
      originalUpdate.delivery_status_source = 'delivery_company'
      originalUpdate.delivery_company_status_raw = originalCarrierState?.rawStatus || null
      originalUpdate.last_delivery_sync_at = now
      originalUpdate.last_status_update_at = now
      if (originalCarrierState?.statusDateField) {
        originalUpdate[originalCarrierState.statusDateField] = now
      }
    }

    if (returnConfirmed) {
      originalUpdate.exchange_completed_at = now
    }

    const { error: originalUpdateError } = await admin
      .from('orders')
      .update(originalUpdate)
      .eq('id', order.id)

    if (originalUpdateError) {
      // Unicité du nouvel ID de colis violée : déjà rattaché à un autre échange.
      if ((originalUpdateError as any)?.code === '23505') {
        return NextResponse.json({ error: 'EXCHANGE_PARCEL_ALREADY_USED' }, { status: 409 })
      }
      throw originalUpdateError
    }

    // 4. Créer la commande de remplacement qui portera le nouveau colis.
    let replacementOrder: { id: string; status: string } | null = null
    let warning = ''

    try {
      replacementOrder = await createExchangeReplacementOrder({
        admin,
        originalOrder: order as Record<string, any>,
        providerSlug,
        newParcelKey,
      })

      const linkNow = new Date().toISOString()
      const { error: linkError } = await admin
        .from('orders')
        .update({
          exchange_status: returnConfirmed ? EXCHANGE_STATUS_COMPLETED : EXCHANGE_STATUS_LINKED,
          exchange_linked_at: linkNow,
          exchange_replacement_order_id: replacementOrder.id,
          updated_at: linkNow,
        })
        .eq('id', order.id)

      if (linkError) throw linkError
    } catch (error) {
      // La demande reste en « requested » : elle peut être relancée pour
      // terminer la création de la commande de remplacement.
      warning = error instanceof Error ? error.message : 'EXCHANGE_REPLACEMENT_ORDER_FAILED'
      console.error('Exchange replacement order failed', { orderId: order.id, warning })
    }

    return NextResponse.json({
      ok: true,
      originalCarrierState,
      newCarrierState,
      originalOrder: {
        id: order.id,
        status: originalUpdate.status || order.status,
        exchangeStatus: replacementOrder
          ? returnConfirmed
            ? EXCHANGE_STATUS_COMPLETED
            : EXCHANGE_STATUS_LINKED
          : EXCHANGE_STATUS_REQUESTED,
      },
      replacementOrder,
      warning,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'FORBIDDEN_ORIGIN') {
      return NextResponse.json({ error: 'FORBIDDEN_ORIGIN' }, { status: 403 })
    }

    const message = error instanceof Error ? error.message : 'EXCHANGE_REQUEST_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}


