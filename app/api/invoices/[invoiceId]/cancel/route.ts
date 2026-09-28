import { NextResponse } from 'next/server'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { hasPermission, type Role } from '@/lib/auth/permissions'
import { getInvoiceErrorStatus } from '@/lib/invoices/settings'

/** Annulation d'une facture : le numéro reste consommé, la pièce est conservée. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const { invoiceId } = await params

    if (!invoiceId) {
      return NextResponse.json({ error: 'MISSING_INVOICE_ID' }, { status: 400 })
    }

    const { data: invoice, error: fetchError } = await supabase
      .from('invoices')
      .select('id, store_id, status')
      .eq('id', invoiceId)
      .maybeSingle()

    if (fetchError) throw fetchError
    if (!invoice) {
      return NextResponse.json({ error: 'INVOICE_NOT_FOUND' }, { status: 404 })
    }

    const member = await verifyStoreAccess(supabase, user.id, invoice.store_id)
    if (!hasPermission(member.role as Role, 'invoices.issue')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as { reason?: string }
    const reason = body.reason ? String(body.reason).replace(/\s+/g, ' ').trim().slice(0, 300) : null

    const { data, error } = await supabase.rpc('rpc_cancel_invoice', {
      p_invoice_id: invoiceId,
      p_reason: reason,
    })

    if (error) throw error

    return NextResponse.json({ result: data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'INVOICE_CANCEL_FAILED'
    return NextResponse.json({ error: message }, { status: getInvoiceErrorStatus(message) })
  }
}
