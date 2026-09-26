'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'

export default function SupplierPurchaseDialog({
  open,
  onClose,
  storeId,
  supplierId,
  supplierName,
}: {
  open: boolean
  onClose: () => void
  storeId: string
  supplierId: string
  supplierName: string
}) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [amountDue, setAmountDue] = useState('')
  const [invoiceReference, setInvoiceReference] = useState('')
  const [note, setNote] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  )
  const [dueDate, setDueDate] = useState('')

  const mutation = useMutation({
    mutationFn: async () => {
      const amount = Number(amountDue)
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Montant invalide.')

      const { data, error } = await supabase.rpc('rpc_record_supplier_purchase', {
        p_store_id: storeId,
        p_supplier_id: supplierId,
        p_amount_due: amount,
        p_purchase_date: purchaseDate ? new Date(purchaseDate + 'T00:00:00').toISOString() : new Date().toISOString(),
        p_due_date: dueDate ? new Date(dueDate + 'T00:00:00').toISOString() : null,
        p_invoice_reference: invoiceReference.trim() || null,
        p_note: note.trim() || null,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      toast.success('Achat enregistré.')
      queryClient.invalidateQueries({ queryKey: ['finance-supplier-balances'] })
      queryClient.invalidateQueries({ queryKey: ['finance-supplier-purchases'] })
      setAmountDue('')
      setInvoiceReference('')
      setNote('')
      onClose()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'RECORD_PURCHASE_FAILED'),
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="p-6 border-b flex items-center justify-between shrink-0">
          <h3 className="text-lg font-semibold text-foreground">Nouvel achat — {supplierName}</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            Fermer
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Montant dû</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={amountDue}
              onChange={(e) => setAmountDue(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Référence facture</label>
            <input
              value={invoiceReference}
              onChange={(e) => setInvoiceReference(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="Optionnel"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Date d&apos;achat</label>
              <input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Échéance</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Note</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="Optionnel"
            />
          </div>
        </div>

        <div className="p-6 border-t flex items-center justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border text-foreground"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
            className="px-4 py-2 rounded-lg bg-[#1fa971] text-white disabled:opacity-50"
          >
            {mutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
