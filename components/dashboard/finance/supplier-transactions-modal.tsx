'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { X, ReceiptText, ShoppingCart, Banknote, Search } from 'lucide-react'

type Purchase = {
  purchase_id: string
  amount_due: number
  allocated: number
  remaining: number
  purchase_date: string | null
  invoice_reference: string | null
}

type Payment = {
  id: string
  amount: number
  paid_at: string
  payment_method: string | null
  reference: string | null
  note: string | null
}

const methodLabel: Record<string, string> = {
  cash: 'Espèces',
  bank_transfer: 'Virement bancaire',
  check: 'Chèque',
  other: 'Autre',
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const fmtDate = (d: string | null) =>
  d
    ? new Date(d).toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

type Tx =
  | { kind: 'purchase'; date: string | null; label: string; amount: number }
  | {
      kind: 'payment'
      date: string
      label: string
      amount: number
      method: string | null
      note: string | null
    }

export default function SupplierTransactionsModal({
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
  const [search, setSearch] = useState('')

  const { data: purchases = [], isLoading: purchasesLoading } = useQuery<Purchase[]>({
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

  const { data: payments = [], isLoading: paymentsLoading } = useQuery<Payment[]>({
    queryKey: ['finance-supplier-payments', storeId, supplierId],
    enabled: open && !!storeId && !!supplierId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supplier_payments')
        .select('id, amount, paid_at, payment_method, reference, note')
        .eq('store_id', storeId)
        .eq('supplier_id', supplierId)
        .order('paid_at', { ascending: false })
      if (error) throw error
      return (data || []) as Payment[]
    },
  })

  const totalDue = useMemo(
    () => round2(purchases.reduce((sum, p) => sum + Number(p.amount_due || 0), 0)),
    [purchases]
  )
  const totalPaid = useMemo(
    () => round2(payments.reduce((sum, p) => sum + Number(p.amount || 0), 0)),
    [payments]
  )
  const remaining = round2(totalDue - totalPaid)

  const transactions = useMemo<Tx[]>(() => {
    const list: Tx[] = []
    purchases.forEach((p) => {
      list.push({
        kind: 'purchase',
        date: p.purchase_date,
        label: p.invoice_reference || 'Achat',
        amount: Number(p.amount_due || 0),
      })
    })
    payments.forEach((pay) => {
      list.push({
        kind: 'payment',
        date: pay.paid_at,
        label: pay.reference || 'Paiement',
        amount: Number(pay.amount || 0),
        method: pay.payment_method,
        note: pay.note,
      })
    })
    return list.sort(
      (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
    )
  }, [purchases, payments])

  const filteredTransactions = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return transactions
    return transactions.filter((tx) => {
      const haystack = [
        tx.label,
        tx.kind === 'payment' ? tx.method || '' : '',
        tx.kind === 'payment' ? tx.note || '' : '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(term)
    })
  }, [transactions, search])

  if (!open) return null

  const isLoading = purchasesLoading || paymentsLoading

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#1fa971]/10 text-[#1fa971] flex items-center justify-center shrink-0">
              <ReceiptText className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">{supplierName}</h3>
              <p className="text-xs text-muted-foreground">Historique des transactions</p>
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

        {/* Body */}
        <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1 min-h-0">
          {/* Synthèse */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-secondary/40 p-3">
              <div className="text-xs text-muted-foreground">Total dû</div>
              <div className="mt-1 text-base font-semibold text-foreground">
                {formatCurrency(totalDue)}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-secondary/40 p-3">
              <div className="text-xs text-muted-foreground">Total payé</div>
              <div className="mt-1 text-base font-semibold text-foreground">
                {formatCurrency(totalPaid)}
              </div>
            </div>
            <div className="rounded-xl border border-[#1fa971]/30 bg-[#1fa971]/5 p-3">
              <div className="text-xs font-medium text-[#1fa971]">Restant</div>
              <div className="mt-1 text-base font-semibold text-[#1fa971]">
                {formatCurrency(remaining)}
              </div>
            </div>
          </div>

          {/* Transactions */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Transactions
            </div>

            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher par référence, chèque, note…"
                className="w-full rounded-xl border border-border bg-background pl-9 pr-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-[#1fa971]/40 focus:border-[#1fa971]"
              />
            </div>

            {isLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Chargement…</div>
            ) : transactions.length === 0 ? (
              <div className="py-12 text-center">
                <div className="text-sm font-medium text-foreground">Aucune transaction</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Aucun achat ni paiement enregistré pour ce fournisseur.
                </div>
              </div>
            ) : filteredTransactions.length === 0 ? (
              <div className="py-12 text-center">
                <div className="text-sm font-medium text-foreground">Aucun résultat</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Aucune transaction ne correspond à votre recherche.
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden divide-y divide-border/40">
                {filteredTransactions.map((tx, idx) => (
                  <div key={idx} className="flex items-center gap-3 px-4 py-3">
                    <div
                      className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
                        tx.kind === 'payment'
                          ? 'bg-[#1fa971]/10 text-[#1fa971]'
                          : 'bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400'
                      }`}
                    >
                      {tx.kind === 'payment' ? (
                        <Banknote className="h-4 w-4" />
                      ) : (
                        <ShoppingCart className="h-4 w-4" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {tx.kind === 'payment' ? 'Paiement' : 'Achat'}
                        </span>
                        <span
                          className={`text-sm font-semibold ${
                            tx.kind === 'payment' ? 'text-[#1fa971]' : 'text-foreground'
                          }`}
                        >
                          {tx.kind === 'payment' ? '−' : '+'} {formatCurrency(tx.amount)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {tx.label} · {fmtDate(tx.date)}
                        {tx.kind === 'payment' && tx.method
                          ? ` · ${methodLabel[tx.method] || tx.method}`
                          : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2 bg-secondary/20 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-secondary"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}
