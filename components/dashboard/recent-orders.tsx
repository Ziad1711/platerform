'use client'

import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'
import { formatCurrency, formatDateTime, getPeriodRange } from '@/lib/utils'
import Link from 'next/link'

const statusLabels: Record<string, string> = {
  new: 'Nouvelle',
  confirmation_rejected: 'Non confirmé',
  follow_up_1: 'Rappel 1',
  follow_up_2: 'Rappel 2',
  follow_up_3: 'Rappel 3',
  follow_up_4: 'Rappel 4',
  follow_up_5: 'Rappel 5',
  no_answer: 'Pas de réponse',
  wrong_number: 'Mauvais numéro',
  voicemail: 'Boîte vocale',
  confirmed: 'Confirmée',
  picked_up: 'Ramassée',
  sent: 'Envoyée',
  delivered: 'Livrée',
  cancelled: 'Annulée',
  refused: 'Refusée',
  returned_not_stocked: 'Retour non stocké',
  returned_stocked: 'Retour stocké',
  dl_no_answer: 'Pas de réponse (livreur)',
  dl_unreachable: 'Injoignable',
  dl_out_of_zone: 'Hors zone',
  dl_client_interested: 'Client intéressé',
  dl_postponed: 'Reportée',
  dl_address_change: 'Changement d\'adresse',
  dl_pickup_pending: 'En attente ramassage',
  dl_refund: 'Remboursement',
  dl_follow_up_request: 'Demande de suivie',
  dl_billing_error: 'Facturé par erreur',
  dl_out_for_delivery: 'Sortie pour livraison',
}

const statusColors: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800',
  confirmation_rejected: 'bg-slate-100 text-slate-800',
  follow_up_1: 'bg-cyan-100 text-cyan-800',
  follow_up_2: 'bg-cyan-100 text-cyan-800',
  follow_up_3: 'bg-cyan-100 text-cyan-800',
  follow_up_4: 'bg-cyan-100 text-cyan-800',
  follow_up_5: 'bg-cyan-100 text-cyan-800',
  no_answer: 'bg-amber-100 text-amber-800',
  wrong_number: 'bg-orange-100 text-orange-800',
  voicemail: 'bg-teal-100 text-teal-800',
  confirmed: 'bg-yellow-100 text-yellow-800',
  picked_up: 'bg-indigo-100 text-indigo-800',
  sent: 'bg-purple-100 text-purple-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-800',
  refused: 'bg-rose-100 text-rose-800',
  returned_not_stocked: 'bg-red-100 text-red-800',
  returned_stocked: 'bg-orange-100 text-orange-800',
  dl_no_answer: 'bg-amber-100 text-amber-800',
  dl_unreachable: 'bg-amber-100 text-amber-800',
  dl_out_of_zone: 'bg-red-100 text-red-800',
  dl_client_interested: 'bg-cyan-100 text-cyan-800',
  dl_postponed: 'bg-slate-100 text-slate-800',
  dl_address_change: 'bg-slate-100 text-slate-800',
  dl_pickup_pending: 'bg-indigo-100 text-indigo-800',
  dl_refund: 'bg-rose-100 text-rose-800',
  dl_follow_up_request: 'bg-cyan-100 text-cyan-800',
  dl_billing_error: 'bg-rose-100 text-rose-800',
  dl_out_for_delivery: 'bg-purple-100 text-purple-800',
}

function formatDeliveryLikeStatus(status: string) {
  if (!status.startsWith('dl_')) return status

  return status
    .replace(/^dl_/, '')
    .split('_')
    .map((part) => {
      if (part === 'no') return 'pas'
      if (part === 'of') return 'de'
      return part
    })
    .join(' ')
    .replace(/pickup pending/i, 'En attente ramassage')
    .replace(/out for delivery/i, 'Sortie pour livraison')
    .replace(/billing error/i, 'Facturé par erreur')
    .replace(/follow up request/i, 'Demande de suivie')
    .replace(/address change/i, "Changement d'adresse")
    .replace(/client interested/i, 'Client intéressé')
    .replace(/out de zone/i, 'Hors zone')
    .replace(/pas answer/i, 'Pas de réponse')
    .replace(/unreachable/i, 'Injoignable')
    .replace(/postponed/i, 'Reportée')
    .replace(/refund/i, 'Remboursement')
}

function getStatusLabel(status: string) {
  return statusLabels[status] || formatDeliveryLikeStatus(status)
}

function getStatusColor(status: string) {
  if (statusColors[status]) return statusColors[status]
  if (status.startsWith('dl_')) return 'bg-slate-100 text-slate-800'
  return 'bg-secondary text-foreground'
}

export default function RecentOrders() {
  const { currentStoreId, accessibleStoreIds, selectedPeriod, customStartDate, customEndDate } = useStore()
  const supabase = createClient()
  const periodRange = getPeriodRange(selectedPeriod, { customStartDate, customEndDate })

  const { data: orders, isLoading } = useQuery({
    queryKey: ['dashboard-recent-orders', currentStoreId, selectedPeriod, customStartDate, customEndDate],
    queryFn: async () => {
      if (!currentStoreId && accessibleStoreIds.length === 0) {
        return []
      }

      let query = supabase
        .from('orders')
        .select('id, customer_name, total_selling_price, status, order_date, tracking_number, updated_at')
        .order('updated_at', { ascending: false })
        .limit(10)

      if (currentStoreId) {
        query = query.eq('store_id', currentStoreId)
      } else {
        query = query.in('store_id', accessibleStoreIds)
      }

      if (periodRange.start) {
        query = query.gte('order_date', periodRange.start.toISOString())
      }

      if (periodRange.end) {
        query = query.lt('order_date', periodRange.end.toISOString())
      }

      const { data, error } = await query
      if (error) throw error
      return data || []
    },
  })

  return (
    <div className="bg-card rounded-xl shadow">
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-foreground">Dernières activités</h3>
          <Link
            href="/sales"
            className="text-sm font-medium text-primary hover:text-primary/80"
          >
            Voir toutes les commandes →
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Chargement...</div>
      ) : orders && orders.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">Commande</th>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">Client</th>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">Statut</th>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">Montant</th>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">Date changement statut</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-border hover:bg-secondary/50">
                  <td className="p-4">
                    <div className="font-medium text-foreground">#{order.id.slice(0, 8)}</div>
                    {order.tracking_number && (
                      <div className="text-xs text-muted-foreground">{order.tracking_number}</div>
                    )}
                  </td>
                  <td className="p-4 text-foreground">{order.customer_name || '-'}</td>
                  <td className="p-4">
                    <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                      {getStatusLabel(order.status)}
                    </span>
                  </td>
                  <td className="p-4 font-medium text-foreground">{formatCurrency(order.total_selling_price || 0)}</td>
                  <td className="p-4 text-muted-foreground">{formatDateTime(order.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-8 text-center text-muted-foreground">Aucune commande pour cette période</div>
      )}
    </div>
  )
}
