import type { InvoiceVatRegime } from './types'

/**
 * Calculs de facture reproduisant exactement `rpc_issue_invoice`.
 *
 * Le RPC reste la source d'autorité : il recalcule tout depuis `orders` et
 * `order_items` et c'est son résultat qui est stocké puis affiché. Ce module
 * sert uniquement à l'aperçu avant émission, il doit donc rester aligné sur
 * l'algorithme SQL (arrondi commercial au centime, demi-valeurs vers le haut).
 *
 * Conventions :
 *   - `prices_include_vat = true` : les prix unitaires sont TTC (cas des
 *     commandes Jisra, le total payé par le client est TTC) ;
 *   - la remise de la commande est répartie au prorata sur les lignes, la
 *     répartition est cumulative pour qu'aucun centime ne soit perdu ;
 *   - les frais de livraison suivent `delivery_taxable` et restent hors TVA
 *     par défaut (port facturé pour le compte du transporteur).
 */

export interface InvoiceCalcSettings {
  vatRegime: InvoiceVatRegime
  vatRate: number
  pricesIncludeVat: boolean
  deliveryTaxable: boolean
}

export interface InvoiceCalcLineInput {
  orderItemId: string
  productId?: string | null
  description: string
  quantity: number
  unitPrice: number
}

export interface InvoiceCalcLine extends InvoiceCalcLineInput {
  lineNo: number
  grossTtc: number
  discountTtc: number
  netTtc: number
  ht: number
  vat: number
  vatRate: number
}

export interface InvoiceCalcTotals {
  itemsTtc: number
  discountTtc: number
  shippingTtc: number
  totalHt: number
  totalVat: number
  totalTtc: number
}

export interface InvoiceCalcResult {
  lines: InvoiceCalcLine[]
  totals: InvoiceCalcTotals
  /** Taux réellement appliqué : 0 dès que le store n'est pas assujetti. */
  vatRate: number
  /** Vrai si le total calculé s'écarte du total enregistré sur la commande. */
  totalMismatch: boolean
}

/** Arrondi commercial au centime, identique à `round(numeric, 2)` de PostgreSQL. */
export function round2(value: number): number {
  const scaled = value * 100
  const rounded = scaled >= 0 ? Math.floor(scaled + 0.5) : Math.ceil(scaled - 0.5)
  return rounded / 100
}

function toCents(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100)
}

function fromCents(value: number): number {
  return value / 100
}

function effectiveVatRate(settings: InvoiceCalcSettings): number {
  if (settings.vatRegime !== 'assujetti') return 0
  const rate = Number(settings.vatRate)
  if (!Number.isFinite(rate) || rate <= 0) return 0
  return rate
}

export function computeInvoice(input: {
  lines: InvoiceCalcLineInput[]
  discountAmount: number
  deliveryChargeToCustomer: number
  orderTotalSellingPrice?: number | null
  settings: InvoiceCalcSettings
}): InvoiceCalcResult {
  const vatRate = effectiveVatRate(input.settings)
  const vatFactor = vatRate / 100

  const prepared = input.lines
    .filter((line) => Number(line.quantity) > 0)
    .map((line) => {
      const quantity = Number(line.quantity)
      const rawUnitPrice = Number(line.unitPrice)
      const unitPrice = Number.isFinite(rawUnitPrice) ? rawUnitPrice : 0
      return {
        line,
        quantity,
        unitPrice,
        grossCents: toCents(quantity * unitPrice),
      }
    })

  const grossTotalCents = prepared.reduce((sum, entry) => sum + entry.grossCents, 0)

  const discountCents = Math.min(toCents(Math.max(Number(input.discountAmount) || 0, 0)), grossTotalCents)
  const netTotalCents = grossTotalCents - discountCents
  const shippingCents = toCents(Math.max(Number(input.deliveryChargeToCustomer) || 0, 0))

  const lines: InvoiceCalcLine[] = []
  let cumulativeGrossCents = 0
  let cumulativeNetCents = 0
  let totalHtCents = 0
  let totalVatCents = 0

  for (const entry of prepared) {
    cumulativeGrossCents += entry.grossCents
    const targetNetCents =
      grossTotalCents > 0 ? Math.round((netTotalCents * cumulativeGrossCents) / grossTotalCents) : 0

    const netCents = targetNetCents - cumulativeNetCents
    cumulativeNetCents = targetNetCents

    let htCents: number
    let vatCents: number
    if (vatFactor > 0) {
      if (input.settings.pricesIncludeVat) {
        htCents = Math.round(netCents / (1 + vatFactor))
        vatCents = netCents - htCents
      } else {
        htCents = netCents
        vatCents = Math.round(netCents * vatFactor)
      }
    } else {
      htCents = netCents
      vatCents = 0
    }

    totalHtCents += htCents
    totalVatCents += vatCents

    lines.push({
      ...entry.line,
      lineNo: lines.length + 1,
      grossTtc: fromCents(entry.grossCents),
      discountTtc: fromCents(entry.grossCents - netCents),
      netTtc: fromCents(netCents),
      ht: fromCents(htCents),
      vat: fromCents(vatCents),
      vatRate,
    })
  }

  let shippingHtCents = shippingCents
  let shippingVatCents = 0

  if (input.settings.deliveryTaxable && shippingCents > 0 && vatFactor > 0) {
    if (input.settings.pricesIncludeVat) {
      shippingHtCents = Math.round(shippingCents / (1 + vatFactor))
      shippingVatCents = shippingCents - shippingHtCents
    } else {
      shippingHtCents = shippingCents
      shippingVatCents = Math.round(shippingCents * vatFactor)
    }
  }

  totalHtCents += shippingHtCents
  totalVatCents += shippingVatCents

  // Le TTC vaut toujours HT + TVA : identique à `net + port` quand les prix sont
  // TTC, et seul calcul correct quand les prix unitaires sont saisis hors taxe.
  const totalTtcCents = totalHtCents + totalVatCents
  const orderTotal =
    input.orderTotalSellingPrice === null || input.orderTotalSellingPrice === undefined
      ? null
      : Number(input.orderTotalSellingPrice)
  const totalTtc = fromCents(totalTtcCents)

  return {
    lines,
    vatRate,
    totals: {
      itemsTtc: fromCents(grossTotalCents),
      discountTtc: fromCents(discountCents),
      shippingTtc: fromCents(shippingCents),
      totalHt: fromCents(totalHtCents),
      totalVat: fromCents(totalVatCents),
      totalTtc,
    },
    totalMismatch: orderTotal !== null && Math.abs(totalTtc - orderTotal) > 0.01,
  }
}
