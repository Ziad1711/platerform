'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'

type AgentOrder = {
  order_id: string
  customer_name: string | null
  phone: string | null
  commission_amount: number
  allocated: number
  remaining: number
}

export default function AgentPaymentDialog({
  open,
  onClose,
  storeId,
  agentId,
  agentName,
}: {
  open: boolean
  onClose: () => void
  storeId: string
  agentId: string
  agentName: string
}) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [amounts, setAmounts] = useState<Record<string, number>>({})

  const { data: orders = [], isLoading } = useQuery<AgentOrder[]>({
    queryKey: ['finance-agent-orders', storeId, agentId],
    enabled: open && !!storeId && !!agentId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rpc_finance_agent_orders', {
        p_store_id: storeId,
        p_agent_id: agentId,
      })
      if (error) throw error
      return (data || []) as AgentOrder[]
    },
  })

  const dueOrders = useMemo(() => orders.filter((o) => o.remaining > 0), [orders])

  const effective = (o: AgentOrder) =>
    amounts[o.order_id] !== undefined ? amounts[o.order_id] : o.remaining

  const total = dueOrders.reduce((sum, o) => sum + effective(o), 0)

  const mutation = useMutation({
    mutationFn: async () => {
      const allocations = dueOrders
        .map((o) => ({ order_id: o.order_id, amount: effective(o) }))
        .filter((a) => a.amount > 0)
      if (allocations.length === 0) throw new Error('Aucune commande à verser.')

      const { data, error } = await supabase.rpc('rpc_record_agent_payment', {
        p_store_id: storeId,
        p_agent_id: agentId,
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
      toast.success('Versement enregistré.')
      queryClient.invalidateQueries({ queryKey: ['finance-agent-balances'] })
      queryClient.invalidateQueries({ queryKey: ['finance-agent-orders'] })
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
          <h3 className="text-lg font-semibold text-foreground">Verser une commission à {agentName}</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            Fermer
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : dueOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune commission acquise à verser.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Commande</th>
                  <th className="py-2 pr-2 font-medium">Commission</th>
                  <th className="py-2 pr-2 font-medium">Reste</th>
                  <th className="py-2 font-medium">Montant à verser</th>
                </tr>
              </thead>
              <tbody>
                {dueOrders.map((o) => (
                  <tr key={o.order_id} className="border-t border-border/50">
                    <td className="py-2 pr-2">
                      <div className="font-medium">{o.customer_name || '—'}</div>
                      <div className="text-xs text-muted-foreground">{o.phone || ''}</div>
                    </td>
                    <td className="py-2 pr-2">{formatCurrency(o.commission_amount)}</td>
                    <td className="py-2 pr-2">{formatCurrency(o.remaining)}</td>
                    <td className="py-2">
                      <input
                        type="number"
                        min={0}
                        max={o.remaining}
                        step="0.01"
                        value={effective(o)}
                        onChange={(e) =>
                          setAmounts((prev) => ({ ...prev, [o.order_id]: Number(e.target.value) || 0 }))
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
            {mutation.isPending ? 'Enregistrement…' : 'Enregistrer le versement'}
          </button>
        </div>
      </div>
    </div>
  )
}
