import { NextResponse } from 'next/server'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { hasPermission, type Role } from '@/lib/auth/permissions'
import {
  INVOICE_ORDER_ITEMS_SELECT,
  INVOICE_ORDER_SELECT,
  buildLineInputs,
  isOrderInvoiceable,
  type InvoiceOrderItemRow,
  type InvoiceOrderRow,
} from '@/lib/invoices/build'
import { computeInvoice } from '@/lib/invoices/calc'
import {
  INVOICE_SETTINGS_SELECT,
  getInvoiceErrorStatus,
  isInvoiceSettingsComplete,
  normalizeInvoiceSettings,
} from '@/lib/invoices/settings'
import type { StoreInvoiceSettings } from '@/lib/invoices/types'

/** Aperçu d'une facture : mêmes règles que l'émission, sans écriture ni numéro. */
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as { storeId?: string; orderId?: string }
    const storeId = String(body.storeId || '').trim()
    const orderId = String(body.orderId || '').trim()

    if (!storeId || !orderId) {
      return NextResponse.json({ error: 'MISSING_INVOICE_TARGET' }, { status: 400 })
    }

    const member = await verifyStoreAccess(supabase, user.id, storeId)
    if (!hasPermission(member.role as Role, 'invoices.view')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const { data: orderRow, error: orderError } = await supabase
      .from('orders')
      .select(INVOICE_ORDER_SELECT)
      .eq('id', orderId)
      .eq('store_id', storeId)
      .maybeSingle()

    if (orderError) throw orderError

    const order = orderRow as unknown as InvoiceOrderRow | null
    if (!order) {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }

    const { data: settingsRow } = await supabase
      .from('store_invoice_settings')
      .select(INVOICE_SETTINGS_SELECT)
      .eq('store_id', storeId)
      .maybeSingle()

    const settings = normalizeInvoiceSettings(
      (settingsRow as unknown as Partial<StoreInvoiceSettings> | null) ?? null,
      storeId
    )

    const { data: existingInvoice } = await supabase
      .from('invoices')
      .select('id, invoice_number, status, issue_date, total_ttc, currency')
      .eq('store_id', storeId)
      .eq('order_id', orderId)
      .maybeSingle()

    const { data: itemRows, error: itemsError } = await supabase
      .from('order_items')
      .select(INVOICE_ORDER_ITEMS_SELECT)
      .eq('order_id', orderId)
      .eq('store_id', storeId)

    if (itemsError) throw itemsError

    const items = (itemRows || []) as unknown as InvoiceOrderItemRow[]
    const productIds = Array.from(new Set(items.map((item) => item.product_id).filter(Boolean))) as string[]
    const variantIds = Array.from(
      new Set(items.map((item) => item.product_variant_id).filter(Boolean))
    ) as string[]

    const [productsResult, variantsResult] = await Promise.all([
      productIds.length
        ? supabase.from('products').select('id, name').in('id', productIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      variantIds.length
        ? supabase.from('product_variants').select('id, name').in('id', variantIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ])

    const productNames = new Map<string, string>(
      (productsResult.data || []).map((row) => [row.id, row.name])
    )
    const variantNames = new Map<string, string>(
      (variantsResult.data || []).map((row) => [row.id, row.name])
    )

    const lines = buildLineInputs(items, productNames, variantNames)
    const calculation = computeInvoice({
      lines,
      discountAmount: Number(order.discount_amount) || 0,
      deliveryChargeToCustomer: Number(order.delivery_charge_to_customer) || 0,
      orderTotalSellingPrice: order.total_selling_price,
      roundingAdjustment: order.rounding_adjustment,
      settings: {
        vatRegime: settings.vat_regime,
        vatRate: settings.vat_rate,
        pricesIncludeVat: settings.prices_include_vat,
        deliveryTaxable: settings.delivery_taxable,
      },
    })

    return NextResponse.json({
      invoiceable: isOrderInvoiceable(order.status) && lines.length > 0,
      settingsComplete: isInvoiceSettingsComplete(settings),
      settings,
      order: {
        id: order.id,
        status: order.status,
        customerName: order.customer_name,
        phone: order.phone,
        address: order.address,
        city: order.city,
        orderDate: order.order_date,
        totalSellingPrice: Number(order.total_selling_price) || 0,
        discountAmount: Number(order.discount_amount) || 0,
        deliveryChargeToCustomer: Number(order.delivery_charge_to_customer) || 0,
      },
      lines: calculation.lines,
      totals: calculation.totals,
      vatRate: calculation.vatRate,
      totalMismatch: calculation.totalMismatch,
      alreadyIssued: existingInvoice ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'INVOICE_PREVIEW_FAILED'
    return NextResponse.json({ error: message }, { status: getInvoiceErrorStatus(message) })
  }
}
