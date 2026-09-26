'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useStore } from '@/lib/store-context'
import { formatCurrency, getPeriodRange } from '@/lib/utils'
import { TrendingUp, TriangleAlert } from 'lucide-react'

type OverviewRow = {
  store_id: string
  currency: string | null
  revenue: number
  revenue_reliable: number
  revenue_estimated: number
  cost_of_goods: number
  delivery_cost: number
  ad_spend: number
  ad_spend_daily: number
  ads_from_orders: number
  ads_daily_days: number
  ads_fallback_days: number
  ads_fallback_orders: number
  ads_partial_days: number
  commission: number
  other_expenses: number
  ads_expense_overlap: number
  ads_expense_overlap_count: number
  operating_result: number
  delivered_orders: number
  estimated_orders: number
  data_issues: number
  result_is_reliable: boolean
}

export default function PnlOverview() {
  const {
    currentStoreId,
    accessibleStoreIds,
    accessibleStores,
    selectedPeriod,
    customStartDate,
    customEndDate,
  } = useStore()
  const supabase = createClient()
  const range = getPeriodRange(selectedPeriod, { customStartDate, customEndDate })
  const targetStoreIds = currentStoreId ? [currentStoreId] : accessibleStoreIds

  const storeNameById = useMemo(
    () => new Map(accessibleStores.map((s) => [s.id, s.name])),
    [accessibleStores]
  )

  const { data = [], isLoading, error } = useQuery<OverviewRow[]>({
    queryKey: ['finance-overview', currentStoreId, accessibleStoreIds, selectedPeriod, customStartDate, customEndDate],
    enabled: targetStoreIds.length > 0,
    queryFn: async () => {
      const rows = await Promise.all(
        targetStoreIds.map(async (storeId) => {
          const { data, error } = await supabase.rpc('rpc_finance_overview', {
            p_store_id: storeId,
            p_start_date: range.start ? range.start.toISOString() : null,
            p_end_date: range.end ? range.end.toISOString() : null,
          })
          if (error) throw error
          return (data?.[0] || null) as OverviewRow | null
        })
      )
      return rows.filter(Boolean) as OverviewRow[]
    },
  })

  const single = data.length === 1 ? data[0] : null

  // Détail publicitaire : source quotidienne, repli par journée non suivie, et
  // journées suivies seulement partiellement couvertes (comptées en entier).
  const adsHint = single
    ? [
        `suivi quotidien ${formatCurrency(single.ad_spend_daily, single.currency || 'MAD')} (${single.ads_daily_days} jour(s))`,
        single.ads_from_orders > 0
          ? `repli commandes ${formatCurrency(single.ads_from_orders, single.currency || 'MAD')} (${single.ads_fallback_days} jour(s) non suivi(s))`
          : null,
        single.ads_partial_days > 0
          ? `${single.ads_partial_days} jour(s) suivi(s) partiellement couvert(s) par la période : comptés en journée entière`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="p-5 border-b border-border/50">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold text-foreground">Résultat opérationnel</h2>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Ventes livrées − coût produits − livraison − publicité − commissions acquises − autres charges.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Publicité : suivi quotidien quand une journée est suivie, sinon repli sur le coût publicitaire des
          commandes de cette journée (aucune journée comptée deux fois). La journée s'entend au fuseau du
          Maroc (Africa/Casablanca) ; une journée suivie mais partiellement couverte par la période est
          comptée en entier et signalée sous la ligne Publicité. Les charges de catégorie
          « Publicité » saisies dans Dépenses restent comptées dans « Autres charges » et sont signalées
          pour éviter un double comptage.
        </p>
      </div>

      {isLoading ? (
        <div className="p-5 text-sm text-muted-foreground">Chargement…</div>
      ) : error ? (
        <div className="p-5 text-sm text-red-600">Impossible de charger le résultat.</div>
      ) : single ? (
        <div className="p-5 space-y-2 text-sm">
          {!single.result_is_reliable && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 p-2 text-amber-800 dark:text-amber-200 text-xs">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Résultat estimé : {single.estimated_orders} commande(s) livrée(s) sans lignes produits
                (CA repris du total de la commande). Le coût produit et le bénéfice de ces commandes
                ne sont pas fiables tant que les lignes ne sont pas saisies.
              </span>
            </div>
          )}
          {single.data_issues > 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 p-2 text-amber-800 dark:text-amber-200 text-xs">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {single.data_issues} commande(s) livrée(s) à vérifier : lignes manquantes, écart entre lignes et total, ou coût nul.
              </span>
            </div>
          )}
          <Line
            label="Chiffre d'affaires (livré)"
            value={formatCurrency(single.revenue, single.currency || 'MAD')}
            hint={`dont fiable ${formatCurrency(single.revenue_reliable, single.currency || 'MAD')} · estimé ${formatCurrency(single.revenue_estimated, single.currency || 'MAD')}`}
          />
          <Line
            label="Coût des produits vendus"
            value={`− ${formatCurrency(single.cost_of_goods, single.currency || 'MAD')}`}
          />
          <Line
            label="Livraison"
            value={`− ${formatCurrency(single.delivery_cost, single.currency || 'MAD')}`}
          />
          <Line
            label="Publicité"
            value={`− ${formatCurrency(single.ad_spend, single.currency || 'MAD')}`}
            hint={adsHint}
          />
          <Line
            label="Commissions acquises"
            value={`− ${formatCurrency(single.commission, single.currency || 'MAD')}`}
          />
          <Line
            label="Autres charges"
            value={`− ${formatCurrency(single.other_expenses, single.currency || 'MAD')}`}
            hint={
              single.ads_expense_overlap > 0
                ? `dont ${single.ads_expense_overlap_count} charge(s) de catégorie Publicité : ${formatCurrency(single.ads_expense_overlap, single.currency || 'MAD')} — vérifier le double comptage avec la ligne Publicité`
                : null
            }
          />
          <div className="flex items-center justify-between border-t border-border/50 pt-3 font-semibold text-foreground">
            <span className="flex items-center gap-2">
              Résultat opérationnel
              {!single.result_is_reliable && (
                <span className="rounded-full bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                  {single.estimated_orders > 0 ? 'Estimé' : 'À vérifier'}
                </span>
              )}
            </span>
            <span className={single.operating_result >= 0 ? 'text-emerald-600' : 'text-red-600'}>
              {formatCurrency(single.operating_result, single.currency || 'MAD')}
            </span>
          </div>
          <p className="text-xs text-muted-foreground pt-1">
            {single.delivered_orders} commande(s) livrée(s) sur la période. Ventes reconnues à la
            livraison ; les commandes sans lignes produits restent comptées dans le CA estimé.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border/50">
                <th className="px-5 py-3 font-medium">Store</th>
                <th className="px-5 py-3 font-medium">CA (livré)</th>
                <th className="px-5 py-3 font-medium">Résultat opérationnel</th>
                <th className="px-5 py-3 font-medium">Fiabilité</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.store_id} className="border-b border-border/40">
                  <td className="px-5 py-3 font-medium text-foreground">
                    {storeNameById.get(r.store_id) || r.store_id}
                  </td>
                  <td className="px-5 py-3 text-foreground">
                    {formatCurrency(r.revenue, r.currency || 'MAD')}
                    {r.revenue_estimated > 0 && (
                      <div className="text-xs text-muted-foreground">
                        dont estimé {formatCurrency(r.revenue_estimated, r.currency || 'MAD')}
                      </div>
                    )}
                  </td>
                  <td className={`px-5 py-3 font-medium ${r.operating_result >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatCurrency(r.operating_result, r.currency || 'MAD')}
                  </td>
                  <td className="px-5 py-3 text-xs">
                    {r.result_is_reliable ? (
                      <span className="text-emerald-600">Fiable</span>
                    ) : r.estimated_orders > 0 ? (
                      <span className="text-amber-700 dark:text-amber-300">Estimé</span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-300">À vérifier</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Line({ label, value, hint }: { label: string; value: string; hint?: string | null }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground">{value}</span>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
