'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useStore } from '@/lib/store-context'
import { usePermissions } from '@/lib/auth/use-permissions'
import { formatCurrency } from '@/lib/utils'
import AgentPaymentDialog from '@/components/dashboard/finance/agent-payment-dialog'

type AgentBalance = {
  agent_id: string
  agent_name: string
  store_id: string
  earned_commission: number
  paid_commission: number
  remaining: number
}

type AgentPayment = {
  id: string
  agent_id: string
  amount: number
  paid_at: string | null
  payment_method: string | null
  reference: string | null
  note: string | null
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Espèces',
  bank_transfer: 'Virement',
  check: 'Chèque',
  other: 'Autre',
}

export default function ConfirmationAgentsPayments() {
  const { currentStoreId } = useStore()
  const { can } = usePermissions(currentStoreId)
  const supabase = createClient()
  const [payAgent, setPayAgent] = useState<AgentBalance | null>(null)

  const canViewFinance = can('finance.view')
  const canRecordPayment = can('finance.payments')
  const enabled = canViewFinance && !!currentStoreId
  const targetStoreIds = currentStoreId ? [currentStoreId] : []

  const { data: agents = [], isLoading } = useQuery<AgentBalance[]>({
    queryKey: ['finance-agent-balances', currentStoreId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rpc_finance_agent_balances', {
        p_store_ids: targetStoreIds,
      })
      if (error) throw error
      return (data || []) as AgentBalance[]
    },
  })

  const { data: payments = [] } = useQuery<AgentPayment[]>({
    queryKey: ['finance-agent-payments', currentStoreId],
    enabled,
    queryFn: async () => {
      if (!currentStoreId) return []
      const { data, error } = await supabase
        .from('confirmation_agent_payments')
        .select('id, agent_id, amount, paid_at, payment_method, reference, note')
        .eq('store_id', currentStoreId)
        .order('paid_at', { ascending: false })
        .limit(10)
      if (error) throw error
      return (data || []) as AgentPayment[]
    },
  })

  const agentNameById = useMemo(
    () => new Map(agents.map((agent) => [agent.agent_id, agent.agent_name])),
    [agents]
  )

  const totalEarned = agents.reduce((sum, agent) => sum + Number(agent.earned_commission || 0), 0)
  const totalPaid = agents.reduce((sum, agent) => sum + Number(agent.paid_commission || 0), 0)
  const totalRemaining = agents.reduce((sum, agent) => sum + Number(agent.remaining || 0), 0)

  if (!currentStoreId) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Sélectionnez un store pour consulter les commissions et enregistrer un versement.
      </div>
    )
  }

  if (!canViewFinance) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Vous n&apos;avez pas accès aux finances de ce store.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead>
            <tr className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <th className="px-3 py-2">Agent</th>
              <th className="px-3 py-2">Acquis</th>
              <th className="px-3 py-2">Versé</th>
              <th className="px-3 py-2">Restant</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-3 py-3 text-muted-foreground">
                  Chargement...
                </td>
              </tr>
            ) : agents.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-3 text-muted-foreground">
                  Aucun agent de confirmation dans ce store.
                </td>
              </tr>
            ) : (
              <>
                {agents.map((agent) => (
                  <tr key={agent.agent_id} className="border-t border-border/50">
                    <td className="px-3 py-2 font-medium text-foreground">{agent.agent_name}</td>
                    <td className="px-3 py-2 text-foreground">
                      {formatCurrency(agent.earned_commission)}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {formatCurrency(agent.paid_commission)}
                    </td>
                    <td className="px-3 py-2 font-medium text-foreground">
                      {formatCurrency(agent.remaining)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canRecordPayment ? (
                        <button
                          type="button"
                          disabled={Number(agent.remaining || 0) <= 0}
                          onClick={() => setPayAgent(agent)}
                          className="rounded-md bg-[#1fa971] px-3 py-1.5 text-xs text-white disabled:opacity-40"
                        >
                          Enregistrer un versement
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-border bg-secondary/40 font-medium">
                  <td className="px-3 py-2 text-foreground">Total</td>
                  <td className="px-3 py-2 text-foreground">{formatCurrency(totalEarned)}</td>
                  <td className="px-3 py-2 text-foreground">{formatCurrency(totalPaid)}</td>
                  <td className="px-3 py-2 text-foreground">{formatCurrency(totalRemaining)}</td>
                  <td className="px-3 py-2" />
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Derniers versements
        </div>
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun versement enregistré.</p>
        ) : (
          <ul className="divide-y divide-border/50 text-sm">
            {payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="text-foreground">
                  {payment.paid_at ? new Date(payment.paid_at).toLocaleDateString('fr-FR') : '—'}
                </span>
                <span className="font-medium text-foreground">
                  {agentNameById.get(payment.agent_id) || 'Agent'}
                </span>
                <span className="text-foreground">{formatCurrency(payment.amount)}</span>
                <span className="text-muted-foreground">
                  {payment.payment_method
                    ? PAYMENT_METHOD_LABELS[payment.payment_method] || payment.payment_method
                    : '—'}
                </span>
                {payment.reference ? (
                  <span className="text-muted-foreground">Réf. {payment.reference}</span>
                ) : null}
                {payment.note ? <span className="text-muted-foreground">{payment.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {payAgent ? (
        <AgentPaymentDialog
          open
          onClose={() => setPayAgent(null)}
          storeId={payAgent.store_id}
          agentId={payAgent.agent_id}
          agentName={payAgent.agent_name}
        />
      ) : null}
    </div>
  )
}
