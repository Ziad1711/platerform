import { NextResponse } from 'next/server'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { hasPermission, type Role } from '@/lib/auth/permissions'
import {
  getConfirmationErrorStatus,
  resolveConfirmationErrorStatus,
} from '@/lib/confirmation/api-errors'
import { CONFIRMATION_PROCESSABLE_STATUSES } from '@/lib/confirmation/constants'

type CustomerInput = {
  customerName?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  cityKey?: number | string | null
}

type DeliveryInput = {
  deliveryNote?: string | null
  deliveryCompanyId?: string | null
  deliveryMode?: 'internal' | 'shipping' | null
}

type ItemInput = {
  productId?: string | null
  productVariantId?: string | null
  quantity?: number | string | null
  unitSellingPrice?: number | string | null
  productNameOverride?: string | null
  itemType?: string | null
}

function toNullableText(value: unknown) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text || null
}

function toNullableUuid(value: unknown) {
  const text = toNullableText(value)
  return text || null
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      orderId?: string
      customer?: CustomerInput | null
      delivery?: DeliveryInput | null
      items?: ItemInput[] | null
    }

    const orderId = String(body.orderId || '').trim()
    if (!orderId) {
      return NextResponse.json({ error: 'MISSING_ORDER_ID' }, { status: 400 })
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, store_id, status, tracking_number, city, delivery_city_external_id')
      .eq('id', orderId)
      .maybeSingle()

    if (orderError) throw orderError
    if (!order) {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }

    const member = await verifyStoreAccess(supabase, user.id, order.store_id)
    if (!hasPermission(member.role as Role, 'confirmation.edit')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    // Garde-fou serveur : on ne modifie pas une commande déjà traitée ou déjà
    // expédiée, même si le client le demande.
    if (!CONFIRMATION_PROCESSABLE_STATUSES.includes(String(order.status))) {
      return NextResponse.json({ error: 'ORDER_NOT_EDITABLE' }, { status: 409 })
    }
    if (toNullableText(order.tracking_number)) {
      return NextResponse.json({ error: 'ORDER_ALREADY_SHIPPED' }, { status: 409 })
    }

    const customer = body.customer || null
    const delivery = body.delivery || null

    const providedCityKey = customer ? toNullableNumber(customer.cityKey) : null
    const nextCity = customer ? toNullableText(customer.city) : null

    // La ville a changé mais aucune clé transporteur n'a été résolue : on efface
    // l'ancienne clé pour que le transporteur recalcule la bonne ville lors de la
    // création du colis. Sans cela, le colis partirait vers l'ancienne ville.
    if (
      nextCity &&
      nextCity.toLowerCase() !== String(order.city || '').trim().toLowerCase() &&
      providedCityKey === null
    ) {
      const { error: clearCityKeyError } = await supabase
        .from('orders')
        .update({ delivery_city_external_id: null })
        .eq('id', orderId)

      if (clearCityKeyError) throw clearCityKeyError
    }

    let items: unknown = null
    if (body.items !== undefined && body.items !== null) {
      if (!Array.isArray(body.items) || body.items.length === 0) {
        return NextResponse.json({ error: 'EMPTY_ITEMS' }, { status: 400 })
      }

      items = body.items.map((item) => ({
        product_id: toNullableUuid(item?.productId),
        product_variant_id: toNullableUuid(item?.productVariantId),
        quantity: toNullableNumber(item?.quantity) ?? 0,
        unit_selling_price: toNullableNumber(item?.unitSellingPrice) ?? 0,
        product_name_override: toNullableText(item?.productNameOverride),
        item_type: toNullableText(item?.itemType) || 'product',
      }))
    }

    // Le nom personnalisé n'est conservé que s'il diffère du nom catalogue :
    // `product_id` reste celui du produit d'origine. Le serveur reste autoritaire
    // même si un appel direct à l'API envoie un nom identique.
    if (Array.isArray(items) && items.length > 0) {
      const rows = items as Array<{ product_id: string | null; product_name_override: string | null }>
      const productIds = Array.from(
        new Set(rows.map((row) => row.product_id).filter(Boolean))
      ) as string[]

      if (productIds.length > 0) {
        const { data: productRows, error: productsError } = await supabase
          .from('products')
          .select('id, name')
          .in('id', productIds)

        if (productsError) throw productsError

        const nameById = new Map(
          ((productRows || []) as Array<{ id: string; name: string | null }>).map((row) => [
            String(row.id),
            String(row.name || '').trim(),
          ])
        )

        items = rows.map((row) => {
          const override = String(row.product_name_override || '').trim()
          const catalogueName = nameById.get(String(row.product_id)) || ''
          return {
            ...row,
            product_name_override: override && override !== catalogueName ? override : null,
          }
        })
      }
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'rpc_update_confirmation_order_details',
      {
        p_order_id: orderId,
        p_customer_name: customer ? toNullableText(customer.customerName) : null,
        p_phone: customer ? toNullableText(customer.phone) : null,
        p_address: customer ? toNullableText(customer.address) : null,
        p_city: customer ? toNullableText(customer.city) : null,
        p_city_key: providedCityKey,
        p_delivery_note: delivery ? toNullableText(delivery.deliveryNote) : null,
        p_delivery_company_id: delivery ? toNullableUuid(delivery.deliveryCompanyId) : null,
        p_delivery_mode: delivery ? toNullableText(delivery.deliveryMode) : null,
        p_items: items,
      }
    )

    if (rpcError) {
      const message = rpcError.message || 'CONFIRMATION_DETAILS_UPDATE_FAILED'
      return NextResponse.json(
        { error: message },
        { status: resolveConfirmationErrorStatus(message) }
      )
    }

    return NextResponse.json({ ok: true, order: rpcData })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CONFIRMATION_DETAILS_UPDATE_FAILED'
    return NextResponse.json({ error: message }, { status: getConfirmationErrorStatus(message) })
  }
}
