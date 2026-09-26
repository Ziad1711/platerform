import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { hasPermission, type Role } from '@/lib/auth/permissions'
import {
  getConfirmationErrorStatus,
  resolveConfirmationErrorStatus,
} from '@/lib/confirmation/api-errors'
import type { ConfirmationAction } from '@/lib/confirmation/constants'
import type { ConfirmationActionResponse } from '@/lib/confirmation/types'

const ALLOWED_ACTIONS: ConfirmationAction[] = ['NO_ANSWER', 'POSTPONE', 'CANCEL', 'CONFIRM']

type ParcelResult = { created: boolean; trackingNumber: string | null; warning: string | null }

/**
 * La confirmation doit créer le colis chez le transporteur comme aujourd'hui.
 * On réutilise le pipeline existant de `/api/orders/status` (normalisation ville,
 * tarif de livraison, tous les transporteurs) au lieu de le réécrire.
 */
async function triggerParcelCreation(
  request: Request,
  orderId: string,
  deliveryNote: string,
  deliveryCompanyId: string | null,
  deliveryMode: 'internal' | 'shipping'
): Promise<ParcelResult> {
  const target = new URL('/api/orders/status', new URL(request.url).origin)

  const response = await fetch(target, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: request.headers.get('cookie') || '',
    },
    body: JSON.stringify({
      orderId,
      status: 'confirmed',
      deliveryNote: deliveryNote || undefined,
      deliveryCompanyId: deliveryMode === 'shipping' && deliveryCompanyId ? deliveryCompanyId : undefined,
      deliveryMode,
    }),
  })

  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; warning?: string; trackingNumber?: string; error?: string }
    | null

  if (!response.ok) {
    return {
      created: false,
      trackingNumber: null,
      warning: payload?.error || 'PARCEL_CREATION_FAILED',
    }
  }

  const trackingNumber = payload?.trackingNumber ? String(payload.trackingNumber) : null
  return { created: Boolean(trackingNumber), trackingNumber, warning: payload?.warning || null }
}

/** Trace le résultat de la création du colis : une erreur transporteur ne doit jamais être silencieuse. */
async function logParcelEvent(input: {
  storeId: string
  orderId: string
  userId: string
  agentId: string | null
  status: string
  parcel: ParcelResult
}) {
  try {
    const admin = createAdminClient()
    await admin.from('order_confirmation_events').insert({
      store_id: input.storeId,
      order_id: input.orderId,
      actor_user_id: input.userId,
      agent_id: input.agentId,
      event_type: input.parcel.created ? 'parcel_creation_succeeded' : 'parcel_creation_failed',
      from_status: input.status,
      to_status: input.status,
      metadata: {
        trackingNumber: input.parcel.trackingNumber,
        warning: input.parcel.warning,
      },
    })
  } catch (error) {
    console.error('CONFIRMATION_PARCEL_EVENT_LOG_FAILED', error)
  }
}

function toNullableString(value: unknown) {
  const text = String(value ?? '').trim()
  return text || null
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      orderId?: string
      action?: string
      callbackAt?: string | null
      reasonCode?: string | null
      note?: string | null
      expectedStatus?: string | null
      expectedAttemptCount?: number | null
      deliveryMode?: 'internal' | 'shipping' | null
      deliveryCompanyId?: string | null
    }

    const orderId = String(body.orderId || '').trim()
    if (!orderId) {
      return NextResponse.json({ error: 'MISSING_ORDER_ID' }, { status: 400 })
    }

    const action = String(body.action || '').trim().toUpperCase() as ConfirmationAction
    if (!ALLOWED_ACTIONS.includes(action)) {
      return NextResponse.json({ error: 'INVALID_ACTION' }, { status: 400 })
    }

    let callbackIso: string | null = null
    if (body.callbackAt) {
      const callbackDate = new Date(body.callbackAt)
      if (Number.isNaN(callbackDate.getTime())) {
        return NextResponse.json({ error: 'INVALID_CALLBACK_DATETIME' }, { status: 400 })
      }
      callbackIso = callbackDate.toISOString()
    }

    // Nombre de tentatives que le client croyait afficher : sert à détecter
    // qu'un autre agent a déjà traité la commande entre-temps.
    const rawExpected = body.expectedAttemptCount
    const parsedExpected = rawExpected === null || rawExpected === undefined ? null : Number(rawExpected)
    const expectedAttemptCount =
      parsedExpected !== null && Number.isFinite(parsedExpected) ? Math.trunc(parsedExpected) : null

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, store_id, status, delivery_company_id, tracking_number, confirmation_agent_id')
      .eq('id', orderId)
      .maybeSingle()

    if (orderError) throw orderError
    if (!order) {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }

    const member = await verifyStoreAccess(supabase, user.id, order.store_id)
    if (!hasPermission(member.role as Role, 'confirmation.process')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    // Garde-fou serveur : la fenêtre de confirmation valide déjà ces informations,
    // mais un appel direct à l'API ne doit pas pouvoir confirmer une commande
    // incomplète (téléphone, ville, au moins un produit).
    if (action === 'CONFIRM') {
      const { data: readiness, error: readinessError } = await supabase
        .from('orders')
        .select('id, phone, city, order_items(id)')
        .eq('id', orderId)
        .maybeSingle()

      if (readinessError) throw readinessError
      if (!readiness) {
        return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
      }
      if (!toNullableString(readiness.phone)) {
        return NextResponse.json({ error: 'MISSING_PHONE' }, { status: 400 })
      }
      if (!toNullableString(readiness.city)) {
        return NextResponse.json({ error: 'MISSING_CITY' }, { status: 400 })
      }
      if (((readiness.order_items || []) as unknown[]).length === 0) {
        return NextResponse.json({ error: 'MISSING_ITEMS' }, { status: 400 })
      }
    }

    // Choix de livraison : l'agent doit explicitement opter pour la livraison
    // interne ou pour une société du store au moment de confirmer.
    let resolvedDeliveryMode: 'internal' | 'shipping' = order.delivery_company_id
      ? 'shipping'
      : 'internal'
    let resolvedDeliveryCompanyId: string | null = order.delivery_company_id || null

    if (action === 'CONFIRM') {
      const requestedMode = String(body.deliveryMode || '').trim()

      if (requestedMode === 'internal') {
        resolvedDeliveryMode = 'internal'
        resolvedDeliveryCompanyId = null
      } else if (requestedMode === 'shipping') {
        const companyId = toNullableString(body.deliveryCompanyId)
        if (!companyId) {
          return NextResponse.json({ error: 'MISSING_DELIVERY_COMPANY' }, { status: 400 })
        }

        const { data: company, error: companyError } = await supabase
          .from('delivery_companies')
          .select('id')
          .eq('id', companyId)
          .eq('store_id', order.store_id)
          .maybeSingle()

        if (companyError) throw companyError
        if (!company) {
          return NextResponse.json({ error: 'DELIVERY_COMPANY_NOT_IN_STORE' }, { status: 400 })
        }

        resolvedDeliveryMode = 'shipping'
        resolvedDeliveryCompanyId = companyId
      } else {
        return NextResponse.json({ error: 'MISSING_DELIVERY_COMPANY' }, { status: 400 })
      }
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc('rpc_order_confirmation_action', {
      p_order_id: orderId,
      p_action: action,
      p_callback_at: callbackIso,
      p_reason_code: toNullableString(body.reasonCode),
      p_note: toNullableString(body.note),
      p_expected_status: toNullableString(body.expectedStatus),
      p_expected_attempt_count: expectedAttemptCount,
    })

    if (rpcError) {
      const message = rpcError.message || 'CONFIRMATION_ACTION_FAILED'
      return NextResponse.json({ error: message }, { status: resolveConfirmationErrorStatus(message) })
    }

    const result = (rpcData || {}) as ConfirmationActionResponse

    let parcel: ParcelResult | undefined

    // La confirmation applique toujours le mode de livraison choisi : c'est cette
    // route qui détache un ancien transporteur en livraison interne, et qui crée
    // le colis en mode transporteur externe.
    if (action === 'CONFIRM') {
      parcel = await triggerParcelCreation(
        request,
        orderId,
        toNullableString(body.note) || '',
        resolvedDeliveryCompanyId,
        resolvedDeliveryMode
      )

      if (resolvedDeliveryMode === 'shipping' && !order.tracking_number) {
        await logParcelEvent({
          storeId: order.store_id,
          orderId,
          userId: user.id,
          agentId: order.confirmation_agent_id || null,
          status: String(result.status || 'confirmed'),
          parcel,
        })
      }
    }

    return NextResponse.json({ ...result, parcel })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CONFIRMATION_ACTION_FAILED'
    return NextResponse.json({ error: message }, { status: getConfirmationErrorStatus(message) })
  }
}

