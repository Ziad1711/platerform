export type ConfirmationEditItem = {
  /** Clé locale stable pour React */
  key: string
  productId: string
  variantId: string | null
  quantity: number
  unitSellingPrice: number
  productNameOverride?: string | null
}

export type ConfirmationProductOption = {
  id: string
  name: string
  default_selling_price: number | null
  default_purchase_cost: number | null
}

export type ConfirmationVariantOption = {
  id: string
  product_id: string
  name: string
  selling_price: number | null
  purchase_cost: number | null
}

export type ConfirmationDeliveryCompanyOption = {
  id: string
  name: string
  is_active: boolean | null
}

export type ConfirmationDetailsUpdateResult = {
  orderId: string
  status: string
  attemptCount: number
  customerName: string | null
  phone: string | null
  address: string | null
  city: string | null
  deliveryNote: string | null
  deliveryCompanyId: string | null
  subtotalAmount: number
  totalSellingPrice: number
  itemCount: number
  customerChanged: boolean
  itemsChanged: boolean
  deliveryChanged: boolean
}
