import { NextResponse } from 'next/server'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { hasPermission, type Role } from '@/lib/auth/permissions'
import { getInvoiceErrorStatus } from '@/lib/invoices/settings'
import type { InvoiceIssueResult } from '@/lib/invoices/types'

const INVOICE_LIST_SELECT = [
  'id',
  'order_id',
  'order_reference',
  'invoice_number',
  'status',
  'issue_date',
  'currency',
  'total_ht',
  'total_vat',
  'total_ttc',
  'created_at',
].join(', ')

const MAX_LINES = 200
const MAX_TEXT = 200

function cleanText(value: unknown, maxLength = MAX_TEXT): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.slice(0, maxLength)
}

function parseBuyer(raw: unknown) {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    name: cleanText(source.name, 150),
    ice: cleanText(source.ice, 40),
    phone: cleanText(source.phone, 40),
    address: cleanText(source.address, 300),
    city: cleanText(source.city, 100),
  }
}

function parseOptions(raw: unknown) {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const issueDate = cleanText(source.issueDate, 10)
  return {
    issueDate: issueDate && /^\d{4}-\d{2}-\d{2}$/.test(issueDate) ? issueDate : null,
    paymentMethod: cleanText(source.paymentMethod, 40),
    paymentReference: cleanText(source.paymentReference, 100),
    notes: cleanText(source.notes, 1000),
  }
}

/** Lignes transmises au RPC : désignation libre, quantités et prix revérifiés en base. */
function parseLines(raw: unknown) {
  if (!Array.isArray(raw)) return null
  const lines = raw
    .slice(0, MAX_LINES)
    .map((entry) => {
      const source = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
      const orderItemId = cleanText(source.orderItemId, 40)
      if (!orderItemId) return null

      const parsed: Record<string, unknown> = { orderItemId }
      const description = cleanText(source.description, MAX_TEXT)
      if (description) parsed.description = description

      const quantity = Number(source.quantity)
      if (Number.isFinite(quantity) && quantity > 0) parsed.quantity = quantity

      const unitPrice = Number(source.unitPrice)
      if (Number.isFinite(unitPrice) && unitPrice >= 0) parsed.unitPrice = unitPrice

      return parsed
    })
    .filter(Boolean)

  return lines.length ? lines : null
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const url = new URL(request.url)
    const storeId = String(url.searchParams.get('storeId') || '').trim()
    const orderId = String(url.searchParams.get('orderId') || '').trim()
    const rawLimit = Number(url.searchParams.get('limit'))

    if (!storeId) {
      return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    }

    const member = await verifyStoreAccess(supabase, user.id, storeId)
    if (!hasPermission(member.role as Role, 'invoices.view')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 200

    let query = supabase
      .from('invoices')
      .select(INVOICE_LIST_SELECT)
      .eq('store_id', storeId)
      .order('issue_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (orderId) {
      query = query.eq('order_id', orderId)
    }

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ invoices: data || [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'INVOICE_LIST_FAILED'
    return NextResponse.json({ error: message }, { status: getInvoiceErrorStatus(message) })
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const storeId = String(body.storeId || '').trim()
    const orderId = String(body.orderId || '').trim()

    if (!storeId || !orderId) {
      return NextResponse.json({ error: 'MISSING_INVOICE_TARGET' }, { status: 400 })
    }

    const member = await verifyStoreAccess(supabase, user.id, storeId)
    if (!hasPermission(member.role as Role, 'invoices.issue')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const { data, error } = await supabase.rpc('rpc_issue_invoice', {
      p_store_id: storeId,
      p_order_id: orderId,
      p_buyer: parseBuyer(body.buyer),
      p_lines: parseLines(body.lines),
      p_options: parseOptions(body.options),
    })

    if (error) throw error

    return NextResponse.json({ invoice: data as unknown as InvoiceIssueResult })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'INVOICE_ISSUE_FAILED'
    return NextResponse.json({ error: message }, { status: getInvoiceErrorStatus(message) })
  }
}
