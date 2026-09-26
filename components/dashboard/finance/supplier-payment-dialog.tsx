'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'

type Purchase = {
  purchase_id: string
  amount_due: number
  allocated: number
  remaining: number
  purchase_date: string | null
  invoice_reference: string | null
}

export default function SupplierPaymentDialog({
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
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [amounts, setAmounts] = useState<Record<string, number>>({})

  const { data: purchases = [], isLoading } = useQuery<Purchase[]>({
    queryKey: ['finance-supplier-purchases', storeId, supplierId],
    enabled: open && !!storeId && !!supplierId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rpc_finance_supplier_purchases', {
        p_store_id: storeId,
        p_supplier_id: supplierId,
      })
      if (error) throw error
      return (data || []) as Purchase[]
    },
  })

  const duePurchases = useMemo(() => purchases.filter((p) => p.remaining > 0), [purchases])

  const effective = (p: Purchase) =>
    amounts[p.purchase_id] !== undefined ? amounts[p.purchase_id] : p.remaining

  const total = duePurchases.reduce((sum, p) => sum + effective(p), 0)

  const mutation = useMutation({
    mutationFn: async () => {
      const allocations = duePurchases
        .map((p) => ({ purchase_id: p.purchase_id, amount: effective(p) }))
        .filter((a) => a.amount > 0)
      if (allocations.length === 0) throw new Error('Aucun achat à payer.')

      const { data, error } = await supabase.rpc('rpc_record_supplier_payment', {
        p_store_id: storeId,
        p_supplier_id: supplierId,
        p_amount: total,
        p_paid_at: new Date().toISOString(),
        p_payment_method: paymentMethod,
        p_reference: reference.trim() || null,
        p_note: note.trim() || null,
        p_allocations: allocations,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      toast.success('Paiement enregistré.')
      queryClient.invalidateQueries({ queryKey: ['finance-supplier-balances'] })
      queryClient.invalidateQueries({ queryKey: ['finance-supplier-purchases'] })
      setAmounts({})
      onClose()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'RECORD_PAYMENT_FAILED'),
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b flex items-center justify-between shrink-0">
          <h3 className="text-lg font-semibold text-foreground">Payer {supplierName}</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            Fermer
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : duePurchases.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun achat restant à payer.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Référence</th>
                  <th className="py-2 pr-2 font-medium">Dû</th>
                  <th className="py-2 pr-2 font-medium">Reste</th>
                  <th className="py-2 font-medium">Montant à payer</th>
                </tr>
              </thead>
              <tbody>
                {duePurchases.map((p) => (
                  <tr key={p.purchase_id} className="border-t border-border/50">
                    <td className="py-2 pr-2">
                      {p.invoice_reference || (p.purchase_date ? new Date(p.purchase_date).toLocaleDateString() : '—')}
                    </td>
                    <td className="py-2 pr-2">{formatCurrency(p.amount_due)}</td>
                    <td className="py-2 pr-2">{formatCurrency(p.remaining)}</td>
                    <td className="py-2">
                      <input
                        type="number"
                        min={0}
                        max={p.remaining}
                        step="0.01"
                        value={effective(p)}
                        onChange={(e) =>
                          setAmounts((prev) => ({ ...prev, [p.purchase_id]: Number(e.target.value) || 0 }))
                        }
                        className="w-28 border rounded-lg px-2 py-1"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Mode de paiement</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
              >
                <option value="cash">Espèces</option>
                <option value="bank_transfer">Virement</option>
                <option value="check">Chèque</option>
                <option value="other">Autre</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Référence</label>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="Optionnel"
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

        <div className="p-6 border-t flex items-center justify-between shrink-0">
          <div className="text-sm font-semibold text-foreground">Total : {formatCurrency(total)}</div>
          <button
            type="button"
            disabled={total <= 0 || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="px-4 py-2 rounded-lg bg-[#1fa971] text-white disabled:opacity-50"
          >
            {mutation.isPending ? 'Enregistrement…' : 'Enregistrer le paiement'}
          </button>
        </div>
      </div>
    </div>
  )
}
