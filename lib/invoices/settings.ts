import type { InvoiceVatRegime, StoreInvoiceSettings, StoreInvoiceSettingsInput } from './types'

export const INVOICE_SETTINGS_SELECT = [
  'store_id',
  'legal_name',
  'legal_form',
  'activity',
  'address',
  'city',
  'phone',
  'email',
  'website',
  'ice',
  'if_number',
  'rc_number',
  'tp_number',
  'vat_regime',
  'vat_rate',
  'prices_include_vat',
  'delivery_taxable',
  'invoice_prefix',
  'bank_name',
  'bank_rib',
  'payment_terms',
  'legal_mentions',
].join(', ')

export const INVOICE_PREFIX_PATTERN = /^[A-Z0-9]{1,8}$/

const VAT_REGIMES: InvoiceVatRegime[] = ['assujetti', 'exonere', 'non_assujetti']

function parseText(value: unknown, maxLength = 200): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.slice(0, maxLength)
}

function parseLongText(value: unknown, maxLength = 1000): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  if (!text) return null
  return text.slice(0, maxLength)
}

export function buildDefaultInvoiceSettings(
  storeId: string,
  storeName: string | null = null
): StoreInvoiceSettings {
  return {
    store_id: storeId,
    legal_name: storeName ? storeName.slice(0, 150) : '',
    legal_form: null,
    activity: null,
    address: null,
    city: null,
    phone: null,
    email: null,
    website: null,
    ice: null,
    if_number: null,
    rc_number: null,
    tp_number: null,
    vat_regime: 'assujetti',
    vat_rate: 20,
    prices_include_vat: true,
    delivery_taxable: false,
    invoice_prefix: 'FAC',
    bank_name: null,
    bank_rib: null,
    payment_terms: null,
    legal_mentions: null,
  }
}

export function normalizeInvoiceSettings(
  row: Partial<StoreInvoiceSettings> | null | undefined,
  storeId: string,
  storeName: string | null = null
): StoreInvoiceSettings {
  const defaults = buildDefaultInvoiceSettings(storeId, storeName)
  if (!row) return defaults

  const regime = VAT_REGIMES.includes(row.vat_regime as InvoiceVatRegime)
    ? (row.vat_regime as InvoiceVatRegime)
    : defaults.vat_regime

  const rawRate = Number(row.vat_rate)
  const rate = Number.isFinite(rawRate) && rawRate >= 0 && rawRate <= 100 ? rawRate : defaults.vat_rate

  const prefix = String(row.invoice_prefix ?? defaults.invoice_prefix).toUpperCase().trim()

  return {
    store_id: storeId,
    legal_name: parseText(row.legal_name, 150) ?? defaults.legal_name,
    legal_form: parseText(row.legal_form),
    activity: parseText(row.activity),
    address: parseText(row.address, 300),
    city: parseText(row.city),
    phone: parseText(row.phone, 40),
    email: parseText(row.email, 150),
    website: parseText(row.website, 200),
    ice: parseText(row.ice, 40),
    if_number: parseText(row.if_number, 40),
    rc_number: parseText(row.rc_number, 40),
    tp_number: parseText(row.tp_number, 40),
    vat_regime: regime,
    vat_rate: rate,
    prices_include_vat: row.prices_include_vat !== false,
    delivery_taxable: row.delivery_taxable === true,
    invoice_prefix: INVOICE_PREFIX_PATTERN.test(prefix) ? prefix : defaults.invoice_prefix,
    bank_name: parseText(row.bank_name, 120),
    bank_rib: parseText(row.bank_rib, 60),
    payment_terms: parseText(row.payment_terms, 200),
    legal_mentions: parseLongText(row.legal_mentions, 1000),
  }
}

/**
 * Une facture ne peut pas être émise sans identité commerciale : le nom légal
 * est la seule mention obligatoire, les autres (ICE, IF, RC, TP) restent
 * recommandées mais paramétrables selon le régime de l'entreprise.
 */
export function isInvoiceSettingsComplete(settings: StoreInvoiceSettings): boolean {
  return Boolean(settings.legal_name && settings.legal_name.trim())
}

export function parseInvoiceSettingsPayload(
  body: Record<string, unknown>,
  storeId: string,
  storeName: string | null = null
): { settings: StoreInvoiceSettingsInput } | { error: string } {
  const normalized = normalizeInvoiceSettings(body as Partial<StoreInvoiceSettings>, storeId, storeName)

  if (!normalized.legal_name) {
    return { error: 'INVOICE_LEGAL_NAME_REQUIRED' }
  }

  if (!VAT_REGIMES.includes(normalized.vat_regime)) {
    return { error: 'INVALID_VAT_REGIME' }
  }

  const rawRate = Number(body.vat_rate)
  if (!Number.isFinite(rawRate) || rawRate < 0 || rawRate > 100) {
    return { error: 'INVALID_VAT_RATE' }
  }

  if (normalized.vat_regime === 'assujetti' && rawRate <= 0) {
    return { error: 'INVALID_VAT_RATE' }
  }

  const rawPrefix = String(body.invoice_prefix ?? 'FAC').toUpperCase().trim()
  if (!INVOICE_PREFIX_PATTERN.test(rawPrefix)) {
    return { error: 'INVALID_INVOICE_PREFIX' }
  }

  const { store_id: _ignored, ...settings } = normalized
  return { settings }
}

/** Statut HTTP associé aux erreurs métier de facturation. */
export function getInvoiceErrorStatus(message: string): number {
  if (message === 'UNAUTHORIZED') return 401
  if (message === 'FORBIDDEN' || message === 'STORE_ACCESS_DENIED') return 403
  if (
    message === 'ORDER_NOT_FOUND' ||
    message === 'INVOICE_NOT_FOUND' ||
    message === 'STORE_NOT_FOUND'
  ) {
    return 404
  }
  if (
    message === 'INVOICE_SETTINGS_MISSING' ||
    message === 'INVOICE_SETTINGS_INCOMPLETE' ||
    message === 'ORDER_NOT_INVOICEABLE' ||
    message === 'ORDER_HAS_NO_ITEMS' ||
    message === 'INVOICE_LINE_MISMATCH' ||
    message === 'INVOICE_TOTAL_MISMATCH'
  ) {
    return 409
  }
  return 400
}
