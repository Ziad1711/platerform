'use client'

import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { CONFIRMATION_EVENT_LABELS, CANCELLATION_REASON_LABELS } from '@/lib/confirmation/constants'
import { getConfirmationStatusColor, getConfirmationStatusLabel } from '@/lib/confirmation/status'
import type { ConfirmationEvent, ConfirmationOrder } from '@/lib/confirmation/types'

type OrderConfirmationDetailsProps = {
  open: boolean
  order: ConfirmationOrder | null
  onClose: () => void
}

type HistoryResponse = {
  events: ConfirmationEvent[]
  actorNames: Record<string, string>
}

export default function OrderConfirmationDetails({
  open,
  order,
  onClose,
}: OrderConfirmationDetailsProps) {
  const { data, isLoading } = useQuery<HistoryResponse>({
    queryKey: ['confirmation-history', order?.id],
    enabled: open && Boolean(order?.id),
    queryFn: async () => {
      const response = await fetch(
        `/api/orders/confirmation/history?orderId=${encodeURIComponent(String(order?.id))}`
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'CONFIRMATION_HISTORY_FETCH_FAILED')
      }
      return payload as HistoryResponse
    },
  })

  const items = order?.order_items || []

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Détails de la commande</DialogTitle>
        </DialogHeader>

        {!order ? null : (
          <div className="space-y-4 text-sm text-foreground">
            <div className="rounded-lg border border-border p-4 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold">{order.customer_name || 'Client inconnu'}</div>
                <span
                  className={`text-xs font-medium rounded-full px-2 py-0.5 ${getConfirmationStatusColor(order.status)}`}
                >
                  {getConfirmationStatusLabel(order.status)}
                </span>
              </div>
              <div>Téléphone : {order.phone || '-'}</div>
              <div>Ville : {order.city || '-'}</div>
              {order.address ? <div>Adresse : {order.address}</div> : null}
              <div className="text-muted-foreground">
                #{String(order.id).slice(0, 8)} •{' '}
                {formatDateTime(order.order_date || new Date().toISOString())}
              </div>
              <div className="text-muted-foreground">
                Appels effectués : {Number(order.confirmation_attempt_count || 0)}
              </div>
            </div>

            <div className="rounded-lg border border-border p-4 space-y-2">
              <div className="text-muted-foreground text-xs">Produits</div>
              {items.length === 0 ? (
                <div className="text-muted-foreground">Aucun produit</div>
              ) : (
                <ul className="space-y-1">
                  {items.map((item, index) => (
                    <li key={`${item.product_name_override || item.products?.name || 'item'}-${index}`}>
                      {Number(item.quantity || 0)} ×{' '}
                      {item.product_name_override || item.products?.name || 'Produit'}
                      {item.unit_selling_price
                        ? ` — ${formatCurrency(Number(item.unit_selling_price || 0))}`
                        : ''}
                    </li>
                  ))}
                </ul>
              )}
              <div className="pt-1 font-semibold">
                Total : {formatCurrency(Number(order.total_selling_price || 0))}
              </div>
            </div>

            {order.cancellation_reason_code ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-800 space-y-1">
                <div className="text-xs">Motif d’annulation</div>
                <div className="font-medium">
                  {CANCELLATION_REASON_LABELS[order.cancellation_reason_code] ||
                    order.cancellation_reason_code}
                </div>
                {order.cancellation_note ? <div>{order.cancellation_note}</div> : null}
              </div>
            ) : null}

            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="text-muted-foreground text-xs">Historique des actions</div>
              {isLoading ? (
                <div className="text-muted-foreground">Chargement...</div>
              ) : (data?.events || []).length === 0 ? (
                <div className="text-muted-foreground">
                  Aucune action de confirmation enregistrée pour cette commande.
                </div>
              ) : (
                <ol className="space-y-2">
                  {(data?.events || []).map((event) => (
                    <li key={event.id} className="border-b border-border pb-2 last:border-b-0 last:pb-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          {CONFIRMATION_EVENT_LABELS[event.event_type] || event.event_type}
                          {event.attempt_number ? ` — Appel ${event.attempt_number}` : ''}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {formatDateTime(event.created_at)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {event.actor_user_id
                          ? data?.actorNames?.[event.actor_user_id] || 'Utilisateur'
                          : 'Système'}
                        {event.callback_at
                          ? ` • rappel prévu ${formatDateTime(event.callback_at)}`
                          : ''}
                        {event.reason_code && CANCELLATION_REASON_LABELS[event.reason_code]
                          ? ` • ${CANCELLATION_REASON_LABELS[event.reason_code]}`
                          : ''}
                      </div>
                      {event.note ? (
                        <div className="text-xs text-foreground mt-1">{event.note}</div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
