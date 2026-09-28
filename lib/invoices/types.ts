export type InvoiceVatRegime = 'assujetti' | 'exonere' | 'non_assujetti'

export type InvoiceStatus = 'issued' | 'cancelled'

export const VAT_REGIME_LABELS: Record<InvoiceVatRegime, string> = {
  assujetti: 'Assujetti à la TVA',
  exonere: 'Exonéré de TVA',
  non_assujetti: 'Non assujetti',
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  issued: 'Émise',
  cancelled: 'Annulée',
}

/** Ligne telle que stockée dans `store_invoice_settings`. */
export interface StoreInvoiceSettings {
  store_id: string
  legal_name: string
  legal_form: string | null
  activity: string | null
  address: string | null
  city: string | null
  phone: string | null
  email: string | null
  website: string | null
  ice: string | null
  if_number: string | null
  rc_number: string | null
  tp_number: string | null
  vat_regime: InvoiceVatRegime
  vat_rate: number
  prices_include_vat: boolean
  delivery_taxable: boolean
  invoice_prefix: string
  bank_name: string | null
  bank_rib: string | null
  payment_terms: string | null
  legal_mentions: string | null
}

/** Champs modifiables depuis l'écran Paramètres > Factures clients. */
export type StoreInvoiceSettingsInput = Omit<StoreInvoiceSettings, 'store_id'>

/** Texte non nul : permet d'isoler les colonnes nullables de la base. */
export type NullableText = string | null

export interface InvoiceSellerSnapshot {
  legalName?: NullableText
  legalForm?: NullableText
  activity?: NullableText
  address?: NullableText
  city?: NullableText
  phone?: NullableText
  email?: NullableText
  website?: NullableText
  ice?: NullableText
  if?: NullableText
  rc?: NullableText
  tp?: NullableText
  bankName?: NullableText
  bankRib?: NullableText
  paymentTerms?: NullableText
  legalMentions?: NullableText
  logoUrl?: NullableText
}

export interface InvoiceBuyerSnapshot {
  name?: NullableText
  ice?: NullableText
  phone?: NullableText
  address?: NullableText
  city?: NullableText
}

export interface InvoiceOrderSnapshot {
  status?: NullableText
  orderDate?: string | null
  subtotalAmount?: number | null
  totalSellingPrice?: number | null
  deliveryChargeToCustomer?: number | null
  discountAmount?: number | null
  discountType?: NullableText
  trackingNumber?: NullableText
}

export interface InvoicePaymentSnapshot {
  method?: NullableText
  reference?: NullableText
}

export interface InvoiceRecord {
  id: string
  store_id: string
  order_id: string | null
  order_reference: string | null
  invoice_number: string
  invoice_year: number
  sequence_number: number
  status: InvoiceStatus
  issue_date: string
  due_date: string | null
  currency: string
  template_version: number
  seller: InvoiceSellerSnapshot
  buyer: InvoiceBuyerSnapshot
  payment: InvoicePaymentSnapshot
  order_snapshot: InvoiceOrderSnapshot
  vat_regime: InvoiceVatRegime
  vat_rate: number
  prices_include_vat: boolean
  delivery_taxable: boolean
  items_ttc: number
  discount_ttc: number
  shipping_ttc: number
  total_ht: number
  total_vat: number
  total_ttc: number
  order_total_snapshot: number | null
  notes: string | null
  created_at: string
  cancelled_at: string | null
  cancellation_reason: string | null
}

export interface InvoiceItemRecord {
  id: string
  invoice_id: string
  line_no: number
  description: string
  quantity: number
  unit_price: number
  line_gross_ttc: number
  line_discount_ttc: number
  line_net_ttc: number
  line_ht: number
  line_vat: number
  vat_rate: number
}

export interface InvoiceWithItems extends InvoiceRecord {
  invoice_items: InvoiceItemRecord[]
}

/** Ligne transmise par le client à l'émission (désignation modifiable, montants recalculés en base). */
export interface InvoiceIssueLineInput {
  orderItemId: string
  description?: string
  quantity?: number
  unitPrice?: number
}

export interface InvoiceIssueBuyerInput {
  name?: string
  ice?: string
  phone?: string
  address?: string
  city?: string
}

export interface InvoiceIssueOptionsInput {
  issueDate?: string
  paymentMethod?: string
  paymentReference?: string
  notes?: string
}

export interface InvoiceIssueResult {
  duplicate: boolean
  invoiceId: string
  invoiceNumber: string
  status: InvoiceStatus
  currency?: string
  totalTtc?: number
  issueDate?: string
  totalMismatch?: boolean
}

export const INVOICE_PAYMENT_METHODS = [
  { value: 'cash', label: 'Espèces à la livraison' },
  { value: 'bank_transfer', label: 'Virement bancaire' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'card', label: 'Carte bancaire' },
  { value: 'other', label: 'Autre' },
] as const

export function getInvoicePaymentMethodLabel(value: string | null | undefined): string {
  if (!value) return '-'
  const found = INVOICE_PAYMENT_METHODS.find((method) => method.value === value)
  return found ? found.label : value
}
