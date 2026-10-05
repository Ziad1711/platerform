import {
  PDFDocument,
  PDFFont,
  PDFPage,
  PDFImage,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib'
import {
  VAT_REGIME_LABELS,
  getInvoicePaymentMethodLabel,
  type InvoiceItemRecord,
  type InvoiceRecord,
} from './types'
import { formatDate } from '@/lib/utils'

/**
 * Rendu A4 d'une facture, sans dépendance à l'HTML ni au navigateur :
 * le même code produit le PDF envoyé au client et l'aperçu téléchargé.
 */

const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89
const MARGIN = 40
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2
const FOOTER_LIMIT = 72

const BRAND = rgb(0.121, 0.663, 0.443)
const BRAND_SOFT = rgb(0.909, 0.965, 0.941)
const INK = rgb(0.09, 0.11, 0.13)
const MUTED = rgb(0.4, 0.44, 0.48)
const BORDER = rgb(0.85, 0.87, 0.89)
const STRIPE = rgb(0.968, 0.976, 0.973)
const DANGER = rgb(0.72, 0.21, 0.21)

const TABLE_HEADERS = [
  { key: 'description', label: 'Désignation', ratio: 0.5, align: 'left' as const },
  { key: 'quantity', label: 'Qté', ratio: 0.09, align: 'center' as const },
  { key: 'unitPrice', label: 'Prix unit.', ratio: 0.18, align: 'right' as const },
  { key: 'vat', label: 'TVA', ratio: 0.08, align: 'center' as const },
  { key: 'total', label: 'Total HT', ratio: 0.15, align: 'right' as const },
]

function tableColumns() {
  let cursor = MARGIN
  return TABLE_HEADERS.map((column) => {
    const width = CONTENT_WIDTH * column.ratio
    const entry = { ...column, x: cursor, width }
    cursor += width
    return entry
  })
}

export interface InvoicePdfInput {
  invoice: InvoiceRecord
  items: InvoiceItemRecord[]
}

/** pdf-lib encode en WinAnsi : on neutralise les espaces fines et les symboles hors Latin-1. */
function sanitize(value: string | null | undefined): string {
  if (!value) return ''
  return String(value)
    .replace(/\u202f|\u00a0/g, ' ')
    .replace(/[\u200b-\u200f\u2028\u2029]/g, '')
    .replace(/[^\u0000-\u00ff\u20ac]/g, '')
    .trim()
}

function money(value: number | null | undefined, currency: string): string {
  const safe = Number.isFinite(Number(value)) ? Number(value) : 0
  const formatted = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(safe)
    .replace(/\u202f|\u00a0/g, ' ')
  return `${formatted} ${sanitize(currency)}`
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(date.getTime())) return '-'
  return formatDate(date)
}

async function embedLogo(pdf: PDFDocument, url: string | null | undefined): Promise<PDFImage | null> {
  if (!url) return null

  try {
    const response = await fetch(url)
    if (!response.ok) return null

    const bytes = new Uint8Array(await response.arrayBuffer())
    const contentType = (response.headers.get('content-type') || '').toLowerCase()

    if (contentType.includes('png')) return await pdf.embedPng(bytes)
    if (contentType.includes('jpeg') || contentType.includes('jpg')) return await pdf.embedJpg(bytes)

    try {
      return await pdf.embedPng(bytes)
    } catch {
      return await pdf.embedJpg(bytes)
    }
  } catch {
    // Logo indisponible : la facture reste valable sans lui.
    return null
  }
}

function drawPanel(page: PDFPage, x: number, y: number, width: number, height: number, fill = false) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: fill ? STRIPE : undefined,
    borderColor: BORDER,
    borderWidth: 1,
  })
}

function drawKeyValue(
  page: PDFPage,
  params: {
    x: number
    y: number
    width: number
    label: string
    value: string
    font: PDFFont
    boldFont: PDFFont
    valueSize?: number
  }
) {
  const { x, y, width, label, value, font, boldFont, valueSize = 9.5 } = params
  page.drawText(sanitize(label).toUpperCase(), { x, y, size: 7.5, font, color: MUTED })

  let cursor = y - 12
  const valueLines = wrapText(value, boldFont, valueSize, width) || ['-']
  for (const line of valueLines.slice(0, 3)) {
    page.drawText(line, { x, y: cursor, size: valueSize, font: boldFont, color: INK })
    cursor -= valueSize + 2
  }
  return cursor
}

function drawHeader(params: {
  page: PDFPage
  invoice: InvoiceRecord
  font: PDFFont
  bold: PDFFont
  logo: PDFImage | null
  top: number
  vatRegimeLabel: string
}) {
  const { page, invoice, font, bold, logo, top, vatRegimeLabel } = params
  const seller = invoice.seller
  const rightEdge = A4_WIDTH - MARGIN

  let leftY = top
  if (logo) {
    const maxWidth = 150
    const maxHeight = 44
    const scale = Math.min(maxWidth / logo.width, maxHeight / logo.height, 1)
    const width = logo.width * scale
    const height = logo.height * scale
    page.drawImage(logo, { x: MARGIN, y: top - height, width, height })
    leftY = top - height - 12
  }

  page.drawText(sanitize(seller.legalName) || 'Vendeur', {
    x: MARGIN,
    y: leftY - 11,
    size: 12,
    font: bold,
    color: INK,
  })
  leftY -= 25

  const sellerLines: string[] = [
    [seller.legalForm, seller.activity].filter(Boolean).join(' - '),
    [seller.address, seller.city].filter(Boolean).join(', '),
    [seller.phone, seller.email].filter(Boolean).join(' | '),
    seller.website ?? '',
  ].filter((line) => sanitize(line).length > 0)

  for (const line of sellerLines) {
    for (const wrapped of wrapText(line, font, 8.5, 250)) {
      page.drawText(wrapped, { x: MARGIN, y: leftY, size: 8.5, font, color: MUTED })
      leftY -= 11
    }
  }

  const title = 'FACTURE'
  page.drawText(title, {
    x: rightEdge - bold.widthOfTextAtSize(title, 22),
    y: top - 20,
    size: 22,
    font: bold,
    color: BRAND,
  })

  const numberY = top - 42
  const numberWidth = 176
  page.drawRectangle({
    x: rightEdge - numberWidth,
    y: numberY - 6,
    width: numberWidth,
    height: 24,
    color: BRAND_SOFT,
  })
  const number = sanitize(invoice.invoice_number)
  page.drawText(number, {
    x: rightEdge - 8 - bold.widthOfTextAtSize(number, 11.5),
    y: numberY,
    size: 11.5,
    font: bold,
    color: BRAND,
  })

  const meta: [string, string][] = [
    ["Date d'émission", dateLabel(invoice.issue_date)],
    ['Échéance de paiement', dateLabel(invoice.due_date)],
    ['Commande', invoice.order_reference ? `#${sanitize(invoice.order_reference)}` : '-'],
    ['Régime TVA', vatRegimeLabel],
  ]

  let metaY = numberY - 26
  for (const [label, value] of meta) {
    const valueText = sanitize(value) || '-'
    page.drawText(label, { x: MARGIN + 296, y: metaY, size: 8, font, color: MUTED })
    page.drawText(valueText, {
      x: rightEdge - bold.widthOfTextAtSize(valueText, 8.5),
      y: metaY,
      size: 8.5,
      font: bold,
      color: INK,
    })
    metaY -= 12.5
  }

  const nextY = Math.min(leftY, metaY) - 10
  page.drawLine({
    start: { x: MARGIN, y: nextY + 6 },
    end: { x: rightEdge, y: nextY + 6 },
    thickness: 1,
    color: BORDER,
  })

  return nextY - 6
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const clean = sanitize(text)
  if (!clean) return []

  const words = clean.split(' ')
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate
      continue
    }

    if (current) lines.push(current)

    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word
      continue
    }

    let chunk = ''
    for (const char of word) {
      if (font.widthOfTextAtSize(chunk + char, size) <= maxWidth) {
        chunk += char
      } else {
        if (chunk) lines.push(chunk)
        chunk = char
      }
    }
    current = chunk
  }

  if (current) lines.push(current)
  return lines
}

function drawPartyPanels(
  page: PDFPage,
  y: number,
  invoice: InvoiceRecord,
  font: PDFFont,
  bold: PDFFont
) {
  const buyer = invoice.buyer
  const payment = invoice.payment
  const gap = 12
  const clientWidth = CONTENT_WIDTH * 0.58
  const paymentWidth = CONTENT_WIDTH - clientWidth - gap
  const height = 96
  const top = y
  const bottom = top - height

  drawPanel(page, MARGIN, bottom, clientWidth, height)
  drawPanel(page, MARGIN + clientWidth + gap, bottom, paymentWidth, height)

  const headerHeight = 16
  page.drawRectangle({
    x: MARGIN,
    y: top - headerHeight,
    width: clientWidth,
    height: headerHeight,
    color: STRIPE,
  })
  page.drawRectangle({
    x: MARGIN + clientWidth + gap,
    y: top - headerHeight,
    width: paymentWidth,
    height: headerHeight,
    color: STRIPE,
  })

  page.drawText('CLIENT', { x: MARGIN + 8, y: top - 11.5, size: 8, font: bold, color: MUTED })
  page.drawText('PAIEMENT', {
    x: MARGIN + clientWidth + gap + 8,
    y: top - 11.5,
    size: 8,
    font: bold,
    color: MUTED,
  })

  const innerTop = top - headerHeight - 12
  const columnWidth = (clientWidth - 24) / 2
  const leftX = MARGIN + 8
  const rightX = leftX + columnWidth + 8

  drawKeyValue(page, {
    x: leftX,
    y: innerTop,
    width: columnWidth,
    label: 'Nom',
    value: buyer.name || '-',
    font,
    boldFont: bold,
  })
  drawKeyValue(page, {
    x: rightX,
    y: innerTop,
    width: columnWidth,
    label: 'Adresse',
    value: [buyer.address, buyer.city].filter(Boolean).join(', ') || '-',
    font,
    boldFont: bold,
  })

  const secondRow = innerTop - 36
  drawKeyValue(page, {
    x: leftX,
    y: secondRow,
    width: columnWidth,
    label: 'ICE',
    value: buyer.ice || '-',
    font,
    boldFont: bold,
  })
  drawKeyValue(page, {
    x: rightX,
    y: secondRow,
    width: columnWidth,
    label: 'Téléphone',
    value: buyer.phone || '-',
    font,
    boldFont: bold,
  })

  const paymentInnerTop = top - headerHeight - 12
  const paymentColumnWidth = paymentWidth - 16

  drawKeyValue(page, {
    x: MARGIN + clientWidth + gap + 8,
    y: paymentInnerTop,
    width: paymentColumnWidth,
    label: 'Mode de règlement',
    value: getInvoicePaymentMethodLabel(payment.method || null),
    font,
    boldFont: bold,
  })
  drawKeyValue(page, {
    x: MARGIN + clientWidth + gap + 8,
    y: paymentInnerTop - 36,
    width: paymentColumnWidth,
    label: 'Référence',
    value: payment.reference || '-',
    font,
    boldFont: bold,
  })

  return bottom - 18
}

function drawTableHeaderRow(page: PDFPage, y: number, font: PDFFont) {
  const height = 20
  page.drawRectangle({ x: MARGIN, y: y - height, width: CONTENT_WIDTH, height, color: BRAND })

  for (const column of tableColumns()) {
    const text = sanitize(column.label)
    const textWidth = font.widthOfTextAtSize(text, 8.5)
    const x =
      column.align === 'right'
        ? column.x + column.width - 8 - textWidth
        : column.align === 'center'
          ? column.x + (column.width - textWidth) / 2
          : column.x + 8

    page.drawText(text, { x, y: y - 13.5, size: 8.5, font, color: rgb(1, 1, 1) })
  }

  return y - height
}

function formatQuantity(value: number): string {
  const quantity = Number(value)
  if (!Number.isFinite(quantity)) return '0'
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2).replace('.', ',')
}

function drawItemsTable(params: {
  pdf: PDFDocument
  page: PDFPage
  y: number
  items: InvoiceItemRecord[]
  invoice: InvoiceRecord
  font: PDFFont
  bold: PDFFont
}) {
  const { pdf, invoice, items, font, bold } = params
  let { page, y } = params
  const columns = tableColumns()
  const descriptionColumn = columns[0]
  const descriptionWidth = descriptionColumn.width - 16

  y = drawTableHeaderRow(page, y, bold)

  for (const item of items) {
    const descriptionLines = wrapText(item.description, font, 9, descriptionWidth)
    const rowHeight = Math.max(20, descriptionLines.length * 11 + 9)

    if (y - rowHeight < FOOTER_LIMIT + 170) {
      page = pdf.addPage([A4_WIDTH, A4_HEIGHT])
      y = A4_HEIGHT - MARGIN
      page.drawText(`Facture ${sanitize(invoice.invoice_number)} (suite)`, {
        x: MARGIN,
        y: y - 12,
        size: 10,
        font: bold,
        color: BRAND,
      })
      y = y - 26
      y = drawTableHeaderRow(page, y, bold)
    }

    if (item.line_no % 2 === 0) {
      page.drawRectangle({
        x: MARGIN,
        y: y - rowHeight,
        width: CONTENT_WIDTH,
        height: rowHeight,
        color: STRIPE,
      })
    }

    const textY = y - 13.5
    let cursorY = y - 13.5
    for (const line of descriptionLines) {
      page.drawText(line, { x: descriptionColumn.x + 8, y: cursorY, size: 9, font, color: INK })
      cursorY -= 11
    }

    const values: { index: number; value: string }[] = [
      { index: 1, value: formatQuantity(item.quantity) },
      { index: 2, value: money(item.unit_price, invoice.currency) },
      { index: 3, value: item.vat_rate > 0 ? `${Number(item.vat_rate)} %` : '-' },
      { index: 4, value: money(item.line_ht, invoice.currency) },
    ]

    for (const entry of values) {
      const column = columns[entry.index]
      const isTotal = entry.index === 4
      const valueFont = isTotal ? bold : font
      const textWidth = valueFont.widthOfTextAtSize(entry.value, isTotal ? 9 : 8.5)
      const x =
        column.align === 'right'
          ? column.x + column.width - 8 - textWidth
          : column.x + (column.width - textWidth) / 2

      page.drawText(entry.value, {
        x,
        y: textY,
        size: isTotal ? 9 : 8.5,
        font: valueFont,
        color: INK,
      })
    }

    page.drawLine({
      start: { x: MARGIN, y: y - rowHeight },
      end: { x: A4_WIDTH - MARGIN, y: y - rowHeight },
      thickness: 0.5,
      color: BORDER,
    })

    y -= rowHeight
  }

  return { page, y: y - 8 }
}

function drawTotalsBlock(page: PDFPage, y: number, invoice: InvoiceRecord, font: PDFFont, bold: PDFFont) {
  const width = 250
  const x = A4_WIDTH - MARGIN - width
  // Détail commercial (montants saisis) séparé du récapitulatif HT / TVA / TTC :
  // `total_ht` inclut déjà la remise et le port, ils ne doivent pas être
  // rejoués une seconde fois dans le cumul.
  const detailRows: [string, string][] = [
    [
      invoice.prices_include_vat ? 'Articles TTC' : 'Articles HT',
      money(invoice.items_ttc, invoice.currency),
    ],
  ]

  if (invoice.discount_ttc > 0) {
    detailRows.push(['Remise commande', `- ${money(invoice.discount_ttc, invoice.currency)}`])
  }
  if (invoice.shipping_ttc > 0) {
    detailRows.push(['Livraison', money(invoice.shipping_ttc, invoice.currency)])
  }
  if (invoice.rounding_ttc > 0) {
    detailRows.push(['Arrondi', `+ ${money(invoice.rounding_ttc, invoice.currency)}`])
  }

  const rows: [string, string][] = [
    ['Total HT', money(invoice.total_ht, invoice.currency)],
    [
      invoice.total_vat > 0 ? `TVA ${Number(invoice.vat_rate)} %` : 'TVA (exonérée)',
      money(invoice.total_vat, invoice.currency),
    ],
  ]

  let cursor = y - 12

  const drawRow = (label: string, value: string) => {
    page.drawText(sanitize(label), { x: x + 10, y: cursor, size: 9, font, color: MUTED })
    page.drawText(value, {
      x: x + width - 10 - font.widthOfTextAtSize(value, 9),
      y: cursor,
      size: 9,
      font,
      color: INK,
    })
    cursor -= 18
  }

  for (const [label, value] of detailRows) {
    drawRow(label, value)
  }

  cursor -= 4
  page.drawLine({
    start: { x: x + 10, y: cursor + 12 },
    end: { x: x + width - 10, y: cursor + 12 },
    thickness: 0.5,
    color: BORDER,
  })

  for (const [label, value] of rows) {
    drawRow(label, value)
  }

  cursor -= 4
  const bandHeight = 30
  const bandBottom = cursor - bandHeight
  page.drawRectangle({ x, y: bandBottom, width, height: bandHeight, color: BRAND_SOFT })

  const totalLabel = 'Total TTC'
  page.drawText(totalLabel, { x: x + 10, y: bandBottom + 10, size: 11, font: bold, color: INK })

  const totalText = money(invoice.total_ttc, invoice.currency)
  page.drawText(totalText, {
    x: x + width - 10 - bold.widthOfTextAtSize(totalText, 12),
    y: bandBottom + 9,
    size: 12,
    font: bold,
    color: BRAND,
  })

  return bandBottom - 16
}

function drawParagraph(
  page: PDFPage,
  params: { x: number; y: number; width: number; label: string; value: string; font: PDFFont; bold: PDFFont }
) {
  const { x, width, label, value, font, bold } = params
  let cursor = params.y
  const lines = wrapText(value, font, 8.5, width)
  if (lines.length === 0) return cursor

  page.drawText(sanitize(label).toUpperCase(), { x, y: cursor, size: 7.5, font: bold, color: MUTED })
  cursor -= 12

  for (const line of lines.slice(0, 4)) {
    page.drawText(line, { x, y: cursor, size: 8.5, font, color: INK })
    cursor -= 11
  }

  return cursor - 8
}

function drawNotesBlock(page: PDFPage, y: number, invoice: InvoiceRecord, font: PDFFont, bold: PDFFont) {
  const width = CONTENT_WIDTH - 262
  const x = MARGIN
  const seller = invoice.seller
  let cursor = y - 12

  const bank = [seller.bankName, seller.bankRib].filter((value) => sanitize(value).length > 0).join(' - ')
  if (bank) {
    cursor = drawParagraph(page, {
      x,
      y: cursor,
      width,
      label: 'Coordonnées bancaires',
      value: bank,
      font,
      bold,
    })
  }

  if (sanitize(seller.paymentTerms)) {
    cursor = drawParagraph(page, {
      x,
      y: cursor,
      width,
      label: 'Conditions de règlement',
      value: seller.paymentTerms || '',
      font,
      bold,
    })
  }

  if (sanitize(invoice.notes)) {
    cursor = drawParagraph(page, {
      x,
      y: cursor,
      width,
      label: 'Note',
      value: invoice.notes || '',
      font,
      bold,
    })
  }

  return cursor
}

function drawPageFooters(pdf: PDFDocument, invoice: InvoiceRecord, font: PDFFont) {
  const pages = pdf.getPages()
  const seller = invoice.seller

  const legalParts = [
    seller.ice ? `ICE : ${seller.ice}` : null,
    seller.if ? `IF : ${seller.if}` : null,
    seller.rc ? `RC : ${seller.rc}` : null,
    seller.tp ? `TP : ${seller.tp}` : null,
  ]
    .filter(Boolean)
    .join('   |   ')

  const mentions = wrapText(seller.legalMentions || '', font, 7.5, CONTENT_WIDTH - 90).slice(0, 2)

  pages.forEach((page, index) => {
    page.drawLine({
      start: { x: MARGIN, y: FOOTER_LIMIT - 10 },
      end: { x: A4_WIDTH - MARGIN, y: FOOTER_LIMIT - 10 },
      thickness: 0.5,
      color: BORDER,
    })

    if (legalParts) {
      page.drawText(sanitize(legalParts), {
        x: MARGIN,
        y: FOOTER_LIMIT - 24,
        size: 7.5,
        font,
        color: MUTED,
      })
    }

    mentions.forEach((line, lineIndex) => {
      page.drawText(line, {
        x: MARGIN,
        y: FOOTER_LIMIT - 35 - lineIndex * 9,
        size: 7.5,
        font,
        color: MUTED,
      })
    })

    const pageLabel = `Page ${index + 1} / ${pages.length}`
    page.drawText(pageLabel, {
      x: A4_WIDTH - MARGIN - font.widthOfTextAtSize(pageLabel, 7.5),
      y: FOOTER_LIMIT - 24,
      size: 7.5,
      font,
      color: MUTED,
    })
  })
}

function drawCancelledWatermark(pdf: PDFDocument, bold: PDFFont) {
  for (const page of pdf.getPages()) {
    const text = 'ANNULÉE'
    const size = 84
    page.drawText(text, {
      x: (A4_WIDTH - bold.widthOfTextAtSize(text, size)) / 2 - 30,
      y: A4_HEIGHT / 2 - 140,
      size,
      font: bold,
      color: DANGER,
      opacity: 0.13,
      rotate: degrees(30),
    })
  }
}

function vatRegimeLabel(invoice: InvoiceRecord): string {
  if (invoice.vat_regime === 'assujetti') {
    return `Assujetti - TVA ${Number(invoice.vat_rate)} %`
  }
  return VAT_REGIME_LABELS[invoice.vat_regime] ?? 'Non assujetti'
}

/**
 * Produit le PDF A4 de la facture. Le logo est récupéré côté serveur ;
 * s'il est indisponible la facture est générée sans lui.
 */
export async function renderInvoicePdf({ invoice, items }: InvoicePdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Facture ${invoice.invoice_number}`)
  pdf.setSubject(`Facture ${invoice.invoice_number}`)
  pdf.setCreator('Jisra')
  pdf.setProducer('Jisra')
  pdf.setAuthor(sanitize(invoice.seller.legalName) || 'Jisra')

  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const logo = await embedLogo(pdf, invoice.seller.logoUrl)

  let page = pdf.addPage([A4_WIDTH, A4_HEIGHT])
  let cursor = drawHeader({
    page,
    invoice,
    font,
    bold,
    logo,
    top: A4_HEIGHT - MARGIN,
    vatRegimeLabel: vatRegimeLabel(invoice),
  })

  cursor = drawPartyPanels(page, cursor, invoice, font, bold)

  const table = drawItemsTable({ pdf, page, y: cursor, items, invoice, font, bold })
  page = table.page
  cursor = table.y

  if (cursor < FOOTER_LIMIT + 180) {
    page = pdf.addPage([A4_WIDTH, A4_HEIGHT])
    cursor = A4_HEIGHT - MARGIN
  }

  cursor = drawNotesBlock(page, cursor, invoice, font, bold)
  drawTotalsBlock(page, cursor + 12, invoice, font, bold)

  drawPageFooters(pdf, invoice, font)

  if (invoice.status === 'cancelled') {
    drawCancelledWatermark(pdf, bold)
  }

  return pdf.save()
}
