'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { X, Banknote } from 'lucide-react'

type Purchase = {
  purchase_id: string
  amount_due: number
  allocated: number
  remaining: number
  purchase_date: string | null
  invoice_reference: string | null
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const resolvePaidAt = (dateStr: string) => {
  if (!dateStr) return new Date().toISOString()
  const now = new Date()
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString()
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
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({})

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

  // Factures dues, les plus anciennes d'abord (répartition FIFO).
  const duePurchases = useMemo(
    () =>
      purchases
        .filter((p) => Number(p.remaining) > 0)
        .sort(
          (a, b) =>
            new Date(a.purchase_date || 0).getTime() - new Date(b.purchase_date || 0).getTime()
        ),
    [purchases]
  )

  const totalRemaining = useMemo(
    () => round2(duePurchases.reduce((sum, p) => sum + Number(p.remaining || 0), 0)),
    [duePurchases]
  )
  const totalDue = useMemo(
    () => round2(purchases.reduce((sum, p) => sum + Number(p.amount_due || 0), 0)),
    [purchases]
  )
  const totalPaid = useMemo(
    () => round2(purchases.reduce((sum, p) => sum + Number(p.allocated || 0), 0)),
    [purchases]
  )

  // Achats sélectionnés par l'utilisateur (par défaut : tous).
  const selectedDuePurchases = useMemo(
    () => duePurchases.filter((p) => selectedIds[p.purchase_id]),
    [duePurchases, selectedIds]
  )
  const selectedRemaining = useMemo(
    () => round2(selectedDuePurchases.reduce((sum, p) => sum + Number(p.remaining || 0), 0)),
    [selectedDuePurchases]
  )

  const amountNum = round2(Number(amount) || 0)
  const exceeds = amountNum > selectedRemaining

  // Répartition du montant saisi sur les achats sélectionnés (plus ancien d'abord).
  const allocation = useMemo(() => {
    let rest = amountNum
    const map: Record<string, number> = {}
    for (const p of selectedDuePurchases) {
      if (rest <= 0) break
      const alloc = Math.min(round2(Number(p.remaining || 0)), rest)
      map[p.purchase_id] = round2(alloc)
      rest = round2(rest - alloc)
    }
    return map
  }, [selectedDuePurchases, amountNum])

  useEffect(() => {
    if (!open) return
    setAmount('')
    setPaymentMethod('cash')
    setReference('')
    setNote('')
    setPaidAt(new Date().toISOString().slice(0, 10))
  }, [open])

  useEffect(() => {
    if (!open) return
    const sel: Record<string, boolean> = {}
    duePurchases.forEach((p) => {
      sel[p.purchase_id] = true
    })
    setSelectedIds(sel)
  }, [open, duePurchases])

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => ({ ...prev, [id]: !prev[id] }))

  const selectAll = () => {
    const sel: Record<string, boolean> = {}
    duePurchases.forEach((p) => {
      sel[p.purchase_id] = true
    })
    setSelectedIds(sel)
    setAmount(String(totalRemaining))
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const allocations = Object.entries(allocation)
        .map(([purchase_id, amt]) => ({ purchase_id, amount: amt }))
        .filter((a) => a.amount > 0)
      if (allocations.length === 0) throw new Error('Aucun achat à payer.')

      const { data, error } = await supabase.rpc('rpc_record_supplier_payment', {
        p_store_id: storeId,
        p_supplier_id: supplierId,
        p_amount: amountNum,
        p_paid_at: resolvePaidAt(paidAt),
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
      queryClient.invalidateQueries({ queryKey: ['suppliers-purchases-summary'] })
      setAmount('')
      onClose()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'RECORD_PAYMENT_FAILED'),
  })

  const remainingAfter = round2(totalRemaining - Math.min(amountNum, totalRemaining))
  const canSubmit =
    amountNum > 0 && !exceeds && !mutation.isPending && selectedDuePurchases.length > 0

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card shadow-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#1fa971]/10 text-[#1fa971] flex items-center justify-center shrink-0">
              <Banknote className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Régler {supplierName}</h3>
              <p className="text-xs text-muted-foreground">Enregistrer un paiement fournisseur</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground inline-flex items-center justify-center shrink-0"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Chargement…</div>
          ) : duePurchases.length === 0 ? (
            <div className="py-12 text-center">
              <div className="text-sm font-medium text-foreground">Aucun paiement dû</div>
              <div className="text-xs text-muted-foreground mt-1">
                Tous les achats de ce fournisseur sont déjà réglés.
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-border bg-secondary/40 p-3">
                  <div className="text-xs text-muted-foreground">Total dû</div>
                  <div className="mt-1 text-base font-semibold text-foreground">
                    {formatCurrency(totalDue)}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-secondary/40 p-3">
                  <div className="text-xs text-muted-foreground">Déjà payé</div>
                  <div className="mt-1 text-base font-semibold text-foreground">
                    {formatCurrency(totalPaid)}
                  </div>
                </div>
                <div className="rounded-xl border border-[#1fa971]/30 bg-[#1fa971]/5 p-3">
                  <div className="text-xs font-medium text-[#1fa971]">Reste à payer</div>
                  <div className="mt-1 text-base font-semibold text-[#1fa971]">
                    {formatCurrency(totalRemaining)}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Montant payé</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={selectedRemaining}
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className={`flex-1 rounded-xl border bg-background px-4 py-2.5 text-lg font-semibold text-foreground outline-none transition focus:ring-2 focus:ring-[#1fa971]/40 focus:border-[#1fa971] ${
                      exceeds ? 'border-red-400' : 'border-border'
                    }`}
                    placeholder="0.00"
                  />
                  <button
                    type="button"
                    onClick={selectAll}
                    className="shrink-0 px-4 py-2.5 rounded-xl bg-[#1fa971] hover:bg-[#1fa971]/90 text-white text-sm font-medium"
                  >
                    Régler tout
                  </button>
                </div>
                {exceeds ? (
                  <p className="mt-1.5 text-xs text-red-600">
                    Le montant dépasse le reste à payer des achats sélectionnés (
                    {formatCurrency(selectedRemaining)}).
                  </p>
                ) : null}
              </div>

              <div className="rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-2.5 bg-secondary/40 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Imputation sur les achats
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border/60">
                      <th className="px-4 py-2 w-10 font-medium"></th>
                      <th className="px-4 py-2 font-medium">Achat</th>
                      <th className="px-4 py-2 font-medium text-right">Dû</th>
                      <th className="px-4 py-2 font-medium text-right">Payé ici</th>
                    </tr>
                  </thead>
                  <tbody>
                    {duePurchases.map((p) => {
                      const checked = !!selectedIds[p.purchase_id]
                      const paidHere = checked ? allocation[p.purchase_id] || 0 : 0
                      return (
                        <tr
                          key={p.purchase_id}
                          className={`border-b border-border/40 last:border-0 ${
                            checked ? '' : 'opacity-50'
                          }`}
                        >
                          <td className="px-4 py-2.5">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSelect(p.purchase_id)}
                              className="h-4 w-4 rounded border-border accent-[#1fa971] cursor-pointer"
                            />
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-foreground">
                              {p.invoice_reference || 'Achat'}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {p.purchase_date
                                ? new Date(p.purchase_date).toLocaleDateString('fr-FR')
                                : '—'}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right text-foreground">
                            {formatCurrency(p.amount_due)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium text-[#1fa971]">
                            {paidHere > 0 ? formatCurrency(paidHere) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {selectedDuePurchases.length === 0 ? (
                  <p className="px-4 py-2.5 text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/20">
                    Sélectionnez au moins un achat à régler.
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Mode de paiement
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-[#1fa971]/40 focus:border-[#1fa971]"
                  >
                    <option value="cash">Espèces</option>
                    <option value="bank_transfer">Virement bancaire</option>
                    <option value="check">Chèque</option>
                    <option value="other">Autre</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Date du paiement
                  </label>
                  <input
                    type="date"
                    value={paidAt}
                    onChange={(e) => setPaidAt(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-[#1fa971]/40 focus:border-[#1fa971]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Référence</label>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-[#1fa971]/40 focus:border-[#1fa971]"
                  placeholder="N° de chèque, référence de virement… (optionnel)"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Note</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-[#1fa971]/40 focus:border-[#1fa971] resize-none"
                  placeholder="Note interne (optionnel)"
                />
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex items-center justify-between gap-3 bg-secondary/20 shrink-0">
          <div className="text-sm text-muted-foreground">
            Restant après paiement :{' '}
            <span className="font-semibold text-foreground">{formatCurrency(remainingAfter)}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-secondary"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => mutation.mutate()}
              className="px-4 py-2.5 rounded-xl bg-[#1fa971] hover:bg-[#1fa971]/90 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {mutation.isPending ? 'Enregistrement…' : `Payer ${formatCurrency(amountNum)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
