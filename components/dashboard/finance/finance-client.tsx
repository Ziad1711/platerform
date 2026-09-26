'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useStore } from '@/lib/store-context'
import { usePermissions } from '@/lib/auth/use-permissions'
import { formatCurrency } from '@/lib/utils'
import StoreSelector from '@/components/dashboard/store-selector'
import { JisraMark } from '@/components/logo'
import { Wallet, TriangleAlert } from 'lucide-react'
import AgentPaymentDialog from '@/components/dashboard/finance/agent-payment-dialog'
import SupplierPurchaseDialog from '@/components/dashboard/finance/supplier-purchase-dialog'
import SupplierPaymentDialog from '@/components/dashboard/finance/supplier-payment-dialog'
import PnlOverview from '@/components/dashboard/finance/pnl-overview'
import PeriodFilter from '@/components/dashboard/period-filter'

type AgentBalance = {
  agent_id: string
  agent_name: string
  store_id: string
  earned_commission: number
  paid_commission: number
  remaining: number
}

type SupplierBalance = {
  supplier_id: string
  supplier_name: string
  store_id: string
  total_due: number
  total_paid: number
  remaining: number
}

export default function FinancesClient() {
  const { currentStoreId, accessibleStoreIds, accessibleStores } = useStore()
  const { can } = usePermissions(currentStoreId)
  const supabase = createClient()

  const storeNameById = useMemo(
    () => new Map(accessibleStores.map((s) => [s.id, s.name])),
    [accessibleStores]
  )

  const targetStoreIds = currentStoreId ? [currentStoreId] : accessibleStoreIds

  const { data: agents = [], isLoading: agentsLoading, error: agentsError } = useQuery<AgentBalance[]>({
    queryKey: ['finance-agent-balances', currentStoreId, accessibleStoreIds],
    enabled: targetStoreIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rpc_finance_agent_balances', {
        p_store_ids: targetStoreIds,
      })
      if (error) throw error
      return (data || []) as AgentBalance[]
    },
  })

  const { data: suppliers = [], isLoading: suppliersLoading, error: suppliersError } = useQuery<SupplierBalance[]>({
    queryKey: ['finance-supplier-balances', currentStoreId, accessibleStoreIds],
    enabled: targetStoreIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rpc_finance_supplier_balances', {
        p_store_ids: targetStoreIds,
      })
      if (error) throw error
      return (data || []) as SupplierBalance[]
    },
  })

  const totalAgentRemaining = agents.reduce((s, a) => s + Number(a.remaining || 0), 0)
  const totalSupplierRemaining = suppliers.reduce((s, a) => s + Number(a.remaining || 0), 0)
  const isSingleStore = !!currentStoreId

  const [payAgent, setPayAgent] = useState<AgentBalance | null>(null)
  const [purchaseSupplier, setPurchaseSupplier] = useState<SupplierBalance | null>(null)
  const [paySupplier, setPaySupplier] = useState<SupplierBalance | null>(null)

  const canRecord = can('finance.payments') && !!currentStoreId

  return (
    <div className="space-y-6 pt-2 sm:pt-0 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="text-center sm:text-left flex flex-col items-center sm:items-start gap-1">
          <div className="flex items-center gap-2">
            <JisraMark size={28} />
            <span className="text-lg font-bold text-[#1fa971] bg-[#1fa971]/10 px-3 py-1 rounded-full">
              Finances
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Résultat, ventes, commissions et fournisseurs
          </p>
        </div>
        <div className="flex items-center justify-center sm:justify-start gap-3 w-full sm:w-auto">
          <StoreSelector />
          <PeriodFilter />
        </div>
      </div>

      <PnlOverview />

      <div className="flex items-start gap-2 rounded-xl border border-amber-300/50 bg-amber-50 dark:bg-amber-950/20 p-4 text-sm text-amber-800 dark:text-amber-200">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Trésorerie non vérifiée : les reversements transporteurs et le solde initial ne sont pas
          encore fiabilisés. Les montants ci-dessous concernent les règlements dus (commissions et
          fournisseurs) uniquement.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Wallet className="h-4 w-4" /> Reste à verser aux agents
          </div>
          <div className="mt-2 text-2xl font-semibold text-foreground">
            {isSingleStore ? formatCurrency(totalAgentRemaining) : '—'}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Wallet className="h-4 w-4" /> Reste à payer aux fournisseurs
          </div>
          <div className="mt-2 text-2xl font-semibold text-foreground">
            {isSingleStore ? formatCurrency(totalSupplierRemaining) : '—'}
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card">
        <div className="p-5 border-b border-border/50">
          <h2 className="font-semibold text-foreground">Commissions des agents</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border/50">
                <th className="px-5 py-3 font-medium">Agent</th>
                <th className="px-5 py-3 font-medium">Acquises</th>
                <th className="px-5 py-3 font-medium">Versées</th>
                <th className="px-5 py-3 font-medium">Restant</th>
                <th className="px-5 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {agentsLoading ? (
                <tr><td colSpan={5} className="px-5 py-4 text-muted-foreground">Chargement…</td></tr>
              ) : agentsError ? (
                <tr><td colSpan={5} className="px-5 py-4 text-red-600">Erreur de chargement.</td></tr>
              ) : agents.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-4 text-muted-foreground">Aucun agent.</td></tr>
              ) : (
                agents.map((a) => (
                  <tr key={`${a.store_id}-${a.agent_id}`} className="border-b border-border/40">
                    <td className="px-5 py-3">
                      <div className="font-medium text-foreground">{a.agent_name}</div>
                      {!currentStoreId && (
                        <div className="text-xs text-muted-foreground">{storeNameById.get(a.store_id) || ''}</div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-foreground">{formatCurrency(a.earned_commission)}</td>
                    <td className="px-5 py-3 text-foreground">{formatCurrency(a.paid_commission)}</td>
                    <td className="px-5 py-3 font-medium text-foreground">{formatCurrency(a.remaining)}</td>
                    <td className="px-5 py-3 text-right">
                      {canRecord && (
                        <button
                          type="button"
                          onClick={() => setPayAgent(a)}
                          className="px-3 py-1.5 rounded-lg bg-[#1fa971] text-white text-xs"
                        >
                          Verser
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="p-5 border-b border-border/50">
          <h2 className="font-semibold text-foreground">Fournisseurs</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Achats enregistrés dans ce module uniquement. Les entrées de stock fournisseur non encore
            rapprochées n&apos;apparaissent pas ici tant qu&apos;elles ne sont pas qualifiées comme dettes.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border/50">
                <th className="px-5 py-3 font-medium">Fournisseur</th>
                <th className="px-5 py-3 font-medium">Dû</th>
                <th className="px-5 py-3 font-medium">Payé</th>
                <th className="px-5 py-3 font-medium">Restant</th>
                <th className="px-5 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {suppliersLoading ? (
                <tr><td colSpan={5} className="px-5 py-4 text-muted-foreground">Chargement…</td></tr>
              ) : suppliersError ? (
                <tr><td colSpan={5} className="px-5 py-4 text-red-600">Erreur de chargement.</td></tr>
              ) : suppliers.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-4 text-muted-foreground">Aucun fournisseur.</td></tr>
              ) : (
                suppliers.map((s) => (
                  <tr key={`${s.store_id}-${s.supplier_id}`} className="border-b border-border/40">
                    <td className="px-5 py-3">
                      <div className="font-medium text-foreground">{s.supplier_name}</div>
                      {!currentStoreId && (
                        <div className="text-xs text-muted-foreground">{storeNameById.get(s.store_id) || ''}</div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-foreground">{formatCurrency(s.total_due)}</td>
                    <td className="px-5 py-3 text-foreground">{formatCurrency(s.total_paid)}</td>
                    <td className="px-5 py-3 font-medium text-foreground">{formatCurrency(s.remaining)}</td>
                    <td className="px-5 py-3 text-right space-x-2">
                      {canRecord && (
                        <>
                          <button
                            type="button"
                            onClick={() => setPurchaseSupplier(s)}
                            className="px-3 py-1.5 rounded-lg border border-border text-foreground text-xs"
                          >
                            Achat
                          </button>
                          <button
                            type="button"
                            onClick={() => setPaySupplier(s)}
                            className="px-3 py-1.5 rounded-lg bg-[#1fa971] text-white text-xs"
                          >
                            Payer
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {payAgent && (
        <AgentPaymentDialog
          open
          onClose={() => setPayAgent(null)}
          storeId={payAgent.store_id}
          agentId={payAgent.agent_id}
          agentName={payAgent.agent_name}
        />
      )}
      {purchaseSupplier && (
        <SupplierPurchaseDialog
          open
          onClose={() => setPurchaseSupplier(null)}
          storeId={purchaseSupplier.store_id}
          supplierId={purchaseSupplier.supplier_id}
          supplierName={purchaseSupplier.supplier_name}
        />
      )}
      {paySupplier && (
        <SupplierPaymentDialog
          open
          onClose={() => setPaySupplier(null)}
          storeId={paySupplier.store_id}
          supplierId={paySupplier.supplier_id}
          supplierName={paySupplier.supplier_name}
        />
      )}
    </div>
  )
}
