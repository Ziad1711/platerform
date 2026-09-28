import { NextResponse } from 'next/server'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { hasPermission, type Role } from '@/lib/auth/permissions'
import { getInvoiceErrorStatus } from '@/lib/invoices/settings'
import type { InvoiceWithItems } from '@/lib/invoices/types'

/** Détail complet d'une facture (en-têtes, totaux, lignes figées). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const { invoiceId } = await params

    if (!invoiceId) {
      return NextResponse.json({ error: 'MISSING_INVOICE_ID' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('invoices')
      .select('*, invoice_items(*)')
      .eq('id', invoiceId)
      .maybeSingle()

    if (error) throw error
    if (!data) {
      return NextResponse.json({ error: 'INVOICE_NOT_FOUND' }, { status: 404 })
    }

    const member = await verifyStoreAccess(supabase, user.id, data.store_id)
    if (!hasPermission(member.role as Role, 'invoices.view')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const invoice = data as unknown as InvoiceWithItems
    invoice.invoice_items = [...(invoice.invoice_items || [])].sort((a, b) => a.line_no - b.line_no)

    return NextResponse.json({ invoice })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'INVOICE_FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: getInvoiceErrorStatus(message) })
  }
}
