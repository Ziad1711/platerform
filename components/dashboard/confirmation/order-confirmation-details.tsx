'use client'

import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Phone,
  MessageCircle,
  MapPin,
  User,
  Package,
  Truck,
  CalendarClock,
  StickyNote,
} from 'lucide-react'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { CONFIRMATION_EVENT_LABELS, CANCELLATION_REASON_LABELS } from '@/lib/confirmation/constants'
import { getConfirmationStatusColor, getConfirmationStatusLabel } from '@/lib/confirmation/status'
import { createClient } from '@/lib/supabase/client'
import { resolveProductImageUrl } from '@/lib/products/product-images'
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

type OrderItem = NonNullable<ConfirmationOrder['order_items']>[number]

function toWhatsAppLink(phone: string | null | undefined) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return null
  const international = digits.startsWith('212') ? digits : `212${digits.replace(/^0/, '')}`
  return `https://wa.me/${international}`
}

function resolveItemImage(supabase: any, item: OrderItem) {
  const images = item.products?.product_images || []
  if (images.length === 0) return null

  const sorted = [...images].sort(
    (a, b) =>
      Number(b.is_primary ?? false) - Number(a.is_primary ?? false) ||
      Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)
  )

  return resolveProductImageUrl(supabase, sorted[0]?.image_url)
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
  const supabase = createClient()
  const whatsappLink = toWhatsAppLink(order?.phone)

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden">
        {!order ? null : (
          <div className="max-h-[85vh] overflow-y-auto">
            <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <DialogTitle className="text-lg font-semibold">Détails de la commande</DialogTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    #{String(order.id).slice(0, 8)} • {formatDateTime(order.order_date || new Date().toISOString())}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-xs font-medium rounded-full px-2.5 py-1 ${getConfirmationStatusColor(order.status)}`}
                >
                  {getConfirmationStatusLabel(order.status)}
                </span>
              </div>
            </DialogHeader>

            <div className="p-6 space-y-5">
              {/* Client */}
              <section className="rounded-xl border border-border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-11 w-11 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                      <User className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground truncate">
                        {order.customer_name || 'Client inconnu'}
                      </div>
                      {order.phone ? (
                        <a href={`tel:${order.phone}`} className="text-sm text-primary hover:underline">
                          {order.phone}
                        </a>
                      ) : (
                        <div className="text-sm text-muted-foreground">Téléphone inconnu</div>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {order.phone ? (
                      <a
                        href={`tel:${order.phone}`}
                        className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
                      >
                        <Phone className="h-4 w-4" />
                        Appeler
                      </a>
                    ) : null}
                    {whatsappLink ? (
                      <a
                        href={whatsappLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#25D366] px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#1DA851]"
                      >
                        <MessageCircle className="h-4 w-4" />
                        WhatsApp
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {order.city ? (
                    <div className="flex items-center gap-2 text-sm text-foreground">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      {order.city}
                    </div>
                  ) : null}
                  {order.address ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <StickyNote className="h-4 w-4" />
                      {order.address}
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <span className="text-muted-foreground">
                    Appels :{' '}
                    <span className="font-medium text-foreground">
                      {Number(order.confirmation_attempt_count || 0)}
                    </span>
                  </span>
                  {order.confirmation_agents?.name ? (
                    <span className="text-muted-foreground">
                      Agent : <span className="font-medium text-foreground">{order.confirmation_agents.name}</span>
                    </span>
                  ) : null}
                  {order.next_callback_at ? (
                    <span className="flex items-center gap-1.5 text-cyan-700">
                      <CalendarClock className="h-4 w-4" />
                      Rappel : {formatDateTime(order.next_callback_at)}
                    </span>
                  ) : null}
                </div>
              </section>

              {/* Produits */}
              <section className="rounded-xl border border-border p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  Produits
                </div>
                {items.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Aucun produit</div>
                ) : (
                  <ul className="divide-y divide-border">
                    {items.map((item, index) => {
                      const imageUrl = resolveItemImage(supabase, item)
                      const name = item.product_name_override || item.products?.name || 'Produit'
                      const quantity = Number(item.quantity || 0)
                      const unitPrice = Number(item.unit_selling_price || 0)

                      return (
                        <li
                          key={`${name}-${index}`}
                          className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                        >
                          {imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={imageUrl}
                              alt={name}
                              className="h-14 w-14 shrink-0 rounded-lg border border-border object-cover"
                            />
                          ) : (
                            <div className="h-14 w-14 shrink-0 rounded-lg border border-border bg-muted flex items-center justify-center">
                              <Package className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-foreground truncate">{name}</div>
                            <div className="text-xs text-muted-foreground">
                              {quantity} × {formatCurrency(unitPrice)}
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-foreground">
                            {formatCurrency(quantity * unitPrice)}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}

                <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                  <div className="text-sm text-muted-foreground">
                    {Number(order.delivery_charge_to_customer || 0) > 0
                      ? `Livraison : ${formatCurrency(Number(order.delivery_charge_to_customer || 0))}`
                      : 'Livraison offerte'}
                  </div>
                  <div className="text-base font-semibold text-foreground">
                    Total : {formatCurrency(Number(order.total_selling_price || 0))}
                  </div>
                </div>
              </section>

              {/* Livraison */}
              {order.delivery_companies?.name || order.tracking_number || order.delivery_note ? (
                <section className="rounded-xl border border-border p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                    <Truck className="h-4 w-4 text-muted-foreground" />
                    Livraison
                  </div>
                  <div className="space-y-1 text-sm text-foreground">
                    {order.delivery_companies?.name ? (
                      <div>Société : {order.delivery_companies.name}</div>
                    ) : null}
                    {order.tracking_number ? <div>Suivi : {order.tracking_number}</div> : null}
                    {order.delivery_note ? (
                      <div className="text-muted-foreground">Note : {order.delivery_note}</div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {/* Motif d'annulation */}
              {order.cancellation_reason_code ? (
                <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
                  <div className="text-xs font-medium uppercase tracking-wide">Motif d’annulation</div>
                  <div className="mt-1 font-medium">
                    {CANCELLATION_REASON_LABELS[order.cancellation_reason_code] ||
                      order.cancellation_reason_code}
                  </div>
                  {order.cancellation_note ? (
                    <div className="mt-1 text-sm">{order.cancellation_note}</div>
                  ) : null}
                </section>
              ) : null}

              {/* Historique */}
              <section className="rounded-xl border border-border p-4">
                <div className="mb-3 text-sm font-medium text-foreground">Historique des actions</div>
                {isLoading ? (
                  <div className="text-sm text-muted-foreground">Chargement...</div>
                ) : (data?.events || []).length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    Aucune action de confirmation enregistrée pour cette commande.
                  </div>
                ) : (
                  <ol>
                    {(data?.events || []).map((event) => (
                      <li key={event.id} className="relative pl-5 pb-4 last:pb-0">
                        <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-primary/60" />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-sm text-foreground">
                            {CONFIRMATION_EVENT_LABELS[event.event_type] || event.event_type}
                            {event.attempt_number ? ` — Appel ${event.attempt_number}` : ''}
                          </span>
                          <span className="text-xs text-muted-foreground">
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
                          <div className="mt-1 text-xs text-foreground">{event.note}</div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
