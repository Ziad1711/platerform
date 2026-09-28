import type { InvoiceCalcLineInput } from './calc'

/** Statuts pour lesquels une facture commerciale n'a pas de sens. */
export const NON_INVOICEABLE_ORDER_STATUSES = ['cancelled', 'confirmation_rejected']

export function isOrderInvoiceable(status: string | null | undefined): boolean {
  if (!status) return false
  return !NON_INVOICEABLE_ORDER_STATUSES.includes(status)
}

export const INVOICE_ORDER_SELECT = [
  'id',
  'store_id',
  'status',
  'customer_name',
  'phone',
  'address',
  'city',
  'order_date',
  'subtotal_amount',
  'discount_amount',
  'discount_type',
  'delivery_charge_to_customer',
  'total_selling_price',
  'tracking_number',
].join(', ')

export const INVOICE_ORDER_ITEMS_SELECT = [
  'id',
  'product_id',
  'product_variant_id',
  'quantity',
  'unit_selling_price',
  'product_name_override',
  'updated_at',
].join(', ')

export interface InvoiceOrderItemRow {
  id: string
  product_id: string | null
  product_variant_id: string | null
  quantity: number
  unit_selling_price: number
  product_name_override: string | null
  updated_at: string
}

/** Colonnes de `orders` lues pour l'aperçu et l'émission d'une facture. */
export interface InvoiceOrderRow {
  id: string
  store_id: string
  status: string
  customer_name: string | null
  phone: string | null
  address: string | null
  city: string | null
  order_date: string
  subtotal_amount: number | null
  discount_amount: number | null
  discount_type: string | null
  delivery_charge_to_customer: number | null
  total_selling_price: number | null
  tracking_number: string | null
}

/**
 * Ordre d'affichage des lignes : identique au tri utilisé par `rpc_issue_invoice`
 * pour que la numérotation de l'aperçu corresponde à la facture émise.
 */
export function sortOrderItems<T extends { updated_at: string; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.updated_at === b.updated_at) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    return a.updated_at < b.updated_at ? -1 : 1
  })
}

/** Désignation affichée sur la facture quand aucune saisie libre n'est fournie. */
export function buildItemDescription(
  item: InvoiceOrderItemRow,
  productNames: Map<string, string>,
  variantNames: Map<string, string>
): string {
  const override = item.product_name_override?.trim()
  const base = override || (item.product_id ? productNames.get(item.product_id) : '') || 'Article'
  const variant = item.product_variant_id ? variantNames.get(item.product_variant_id) : ''
  return variant ? `${base} - ${variant}` : base
}

export function buildLineInputs(
  items: InvoiceOrderItemRow[],
  productNames: Map<string, string>,
  variantNames: Map<string, string>
): InvoiceCalcLineInput[] {
  return sortOrderItems(items)
    .filter((item) => Number(item.quantity) > 0)
    .map((item) => ({
      orderItemId: item.id,
      productId: item.product_id,
      description: buildItemDescription(item, productNames, variantNames),
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_selling_price),
    }))
}
