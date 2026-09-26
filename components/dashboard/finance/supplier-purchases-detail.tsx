'use client'

import { useQuery } from '@tanstack/react-query'
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

export default function SupplierPurchasesDetail({
  storeId,
  supplierId,
  enabled,
}: {
  storeId: string
  supplierId: string
  enabled: boolean
}) {
  const supabase = createClient()

  const { data: purchases = [], isLoading, error } = useQuery<Purchase[]>({
    queryKey: ['finance-supplier-purchases', storeId, supplierId],
    enabled: enabled && !!storeId && !!supplierId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rpc_finance_supplier_purchases', {
        p_store_id: storeId,
        p_supplier_id: supplierId,
      })
      if (error) throw error
      return (data || []) as Purchase[]
    },
  })

  if (isLoading) {
    return <div className="px-6 py-4 text-sm text-muted-foreground">Chargement du détail...</div>
  }

  if (error) {
    return <div className="px-6 py-4 text-sm text-red-600">Détail des achats indisponible.</div>
  }

  if (purchases.length === 0) {
    return (
      <div className="px-6 py-4 text-sm text-muted-foreground">
        Aucun achat enregistré pour ce fournisseur.
      </div>
    )
  }

  return (
    <div className="px-6 py-4 bg-secondary/40">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        Détail par achat — dû − payé = reste
      </div>
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1.5 pr-4 font-medium">Date</th>
            <th className="py-1.5 pr-4 font-medium">Référence facture</th>
            <th className="py-1.5 pr-4 font-medium">Dû</th>
            <th className="py-1.5 pr-4 font-medium">Payé</th>
            <th className="py-1.5 font-medium">Reste</th>
          </tr>
        </thead>
        <tbody>
          {purchases.map((purchase) => (
            <tr key={purchase.purchase_id} className="border-t border-border/40">
              <td className="py-1.5 pr-4 text-foreground">
                {purchase.purchase_date
                  ? new Date(purchase.purchase_date).toLocaleDateString('fr-FR')
                  : '—'}
              </td>
              <td className="py-1.5 pr-4 text-foreground">{purchase.invoice_reference || '—'}</td>
              <td className="py-1.5 pr-4 text-foreground">{formatCurrency(purchase.amount_due)}</td>
              <td className="py-1.5 pr-4 text-foreground">{formatCurrency(purchase.allocated)}</td>
              <td className="py-1.5 font-medium text-foreground">
                {formatCurrency(purchase.remaining)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
