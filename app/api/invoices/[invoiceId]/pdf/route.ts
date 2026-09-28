import { NextResponse } from 'next/server'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { hasPermission, type Role } from '@/lib/auth/permissions'
import { getInvoiceErrorStatus } from '@/lib/invoices/settings'
import { renderInvoicePdf } from '@/lib/invoices/pdf'
import type { InvoiceItemRecord, InvoiceRecord, InvoiceWithItems } from '@/lib/invoices/types'

/** Téléchargement / aperçu A4 de la facture. */
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

    const payload = data as unknown as InvoiceWithItems
    const items: InvoiceItemRecord[] = [...(payload.invoice_items || [])].sort(
      (a, b) => a.line_no - b.line_no
    )
    const invoice: InvoiceRecord = { ...payload }
    // Les lignes sont déjà extraites : le rendu PDF ne reçoit que l'entête.
    delete (invoice as unknown as Record<string, unknown>).invoice_items

    const pdfBytes = await renderInvoicePdf({
      invoice: invoice as InvoiceRecord,
      items,
    })

    const filename = `${invoice.invoice_number.replace(/[^A-Za-z0-9-_]/g, '-')}.pdf`

    return new Response(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'INVOICE_PDF_FAILED'
    return NextResponse.json({ error: message }, { status: getInvoiceErrorStatus(message) })
  }
}
