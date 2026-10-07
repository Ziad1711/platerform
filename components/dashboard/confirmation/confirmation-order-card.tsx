'use client'

import { useMemo } from 'react'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { formatNextAttemptLabel } from '@/lib/confirmation/constants'
import { getConfirmationStatusColor, getConfirmationStatusLabel } from '@/lib/confirmation/status'
import type { ConfirmationOrder } from '@/lib/confirmation/types'
import { createClient } from '@/lib/supabase/client'
import { resolveProductImageUrl } from '@/lib/products/product-images'
import { Phone, MessageCircle, Package } from 'lucide-react'

type ConfirmationOrderCardProps = {
  order: ConfirmationOrder
  maxAttempts: number
  busy: boolean
  onNoAnswer: () => void
  onPostpone: () => void
  onCancel: () => void
  onConfirm: () => void
  onEdit: () => void
  onOpenDetails: () => void
}

function toWhatsAppLink(phone: string | null | undefined) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return null
  const international = digits.startsWith('212') ? digits : `212${digits.replace(/^0/, '')}`
  return `https://wa.me/${international}`
}

function summarizeProducts(order: ConfirmationOrder) {
  const items = order.order_items || []
  if (items.length === 0) return 'Aucun produit'

  return items
    .map((item) => {
      const name = item.product_name_override || item.products?.name || 'Produit'
      const quantity = Number(item.quantity || 0)
      const variant = item.product_variants?.name
      return `${quantity} × ${name}${variant ? ` (${variant})` : ''}`
    })
    .join(' • ')
}

type OrderItem = NonNullable<ConfirmationOrder['order_items']>[number]

type ProductImageRow = {
  image_url: string | null
  is_primary: boolean | null
  sort_order: number | null
}

/** Image principale d'un groupe (primaire d'abord, puis ordre d'affichage). */
function pickPrimaryImageUrl(images: ProductImageRow[] | null | undefined) {
  if (!images || images.length === 0) return null

  const sorted = [...images].sort(
    (a, b) =>
      Number(b.is_primary ?? false) - Number(a.is_primary ?? false) ||
      Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)
  )

  return sorted[0]?.image_url ?? null
}

/**
 * Photo d'une ligne de commande (image Storage ou URL externe).
 * On privilégie la photo de la variante achetée ; à défaut, la galerie produit
 * (images sans variante uniquement, pour ne pas afficher une autre variante).
 */
function resolveItemImage(supabase: any, item: OrderItem) {
  const variantImage = pickPrimaryImageUrl(item.product_variants?.product_images)
  if (variantImage) return resolveProductImageUrl(supabase, variantImage)

  const productImages = (item.products?.product_images || []).filter(
    (image) => !image.product_variant_id
  )

  return resolveProductImageUrl(supabase, pickPrimaryImageUrl(productImages))
}

export default function ConfirmationOrderCard({
  order,
  maxAttempts,
  busy,
  onNoAnswer,
  onPostpone,
  onCancel,
  onConfirm,
  onEdit,
  onOpenDetails,
}: ConfirmationOrderCardProps) {
  const supabase = useMemo(() => createClient(), [])
  const attempts = Number(order.confirmation_attempt_count || 0)
  const isLastAttempt = attempts + 1 >= maxAttempts
  const whatsappLink = toWhatsAppLink(order.phone)
  const isFinalState = order.status === 'confirmed' || order.status === 'cancelled'

  const contactActions = (
    <>
      {order.phone ? (
        <a
          href={`tel:${order.phone}`}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
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
          className="inline-flex items-center gap-2 rounded-md bg-[#25D366] px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#1DA851]"
        >
          <MessageCircle className="h-4 w-4" />
          WhatsApp
        </a>
      ) : null}
      <button
        type="button"
        disabled={busy || isFinalState}
        onClick={onEdit}
        className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary disabled:opacity-50"
      >
        Modifier
      </button>
      <button
        type="button"
        onClick={onOpenDetails}
        className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary"
      >
        Détails
      </button>
    </>
  )

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground">{order.customer_name || 'Client inconnu'}</span>
            <span
              className={`text-xs font-medium rounded-full px-2 py-0.5 ${getConfirmationStatusColor(order.status)}`}
            >
              {getConfirmationStatusLabel(order.status)}
            </span>
            {order.is_blacklisted ? (
              <span className="text-[11px] font-medium rounded-full bg-red-100 text-red-700 px-2 py-0.5">
                Numéro blacklisté
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            #{String(order.id).slice(0, 8)} • {formatDateTime(order.order_date || new Date().toISOString())}
          </div>
        </div>

        <div className="text-right">
          <div className="text-sm font-semibold text-foreground">
            {formatCurrency(Number(order.total_selling_price || 0))}
          </div>
          <div className="text-xs text-muted-foreground">
            Appels : {attempts} / {maxAttempts}
          </div>
        </div>
      </div>

      {/* Corps : photo à gauche, informations à droite */}
      <div className="flex gap-4">
        {(order.order_items || []).length > 0 ? (
          <div
            className={`grid shrink-0 gap-1.5 ${
              (order.order_items || []).length > 1 ? 'grid-cols-2' : 'grid-cols-1'
            }`}
          >
            {(order.order_items || []).map((item, index) => {
              const url = resolveItemImage(supabase, item)
              const name = item.product_name_override || item.products?.name || 'Produit'
              const variant = item.product_variants?.name
              const label = variant ? `${name} — ${variant}` : name

              return url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${name}-${index}`}
                  src={url}
                  alt={label}
                  title={label}
                  className="h-28 w-28 rounded-md border border-border object-cover sm:h-40 sm:w-40"
                />
              ) : (
                <div
                  key={`${name}-${index}`}
                  title={label}
                  className="flex h-28 w-28 items-center justify-center rounded-md border border-border bg-muted sm:h-40 sm:w-40"
                >
                  <Package className="h-8 w-8 text-muted-foreground sm:h-10 sm:w-10" />
                </div>
              )
            })}
          </div>
        ) : null}

        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-sm text-foreground space-y-1">
            <div>Téléphone : {order.phone || '-'}</div>
            <div>Ville : {order.city || '-'}</div>
            {order.address ? <div className="text-muted-foreground">Adresse : {order.address}</div> : null}
            <div className="text-muted-foreground">{summarizeProducts(order)}</div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              Dernière action :{' '}
              {order.confirmation_last_action_at ? formatDateTime(order.confirmation_last_action_at) : '-'}
            </span>
            {order.next_callback_at ? (
              <span className="rounded-full bg-cyan-100 text-cyan-800 px-2 py-0.5 font-medium">
                Rappel prévu : {formatDateTime(order.next_callback_at)}
              </span>
            ) : null}
            {order.confirmation_agents?.name ? (
              <span className="rounded-full bg-secondary px-2 py-0.5 font-medium">
                Agent : {order.confirmation_agents.name}
              </span>
            ) : null}
            {order.tracking_number ? (
              <span className="rounded-full bg-secondary px-2 py-0.5">Suivi : {order.tracking_number}</span>
            ) : null}
          </div>

          <div className="hidden flex-wrap items-center gap-2 sm:flex">{contactActions}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:hidden">{contactActions}</div>

      {!isFinalState ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onNoAnswer}
            className="rounded-md bg-amber-100 text-amber-900 px-3 py-2 text-sm font-medium hover:bg-amber-200 disabled:opacity-50"
          >
            {formatNextAttemptLabel(attempts, maxAttempts)}
            {isLastAttempt ? (
              <span className="block text-[11px] font-normal">puis annulation automatique</span>
            ) : null}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onPostpone}
            className="rounded-md bg-cyan-100 text-cyan-900 px-3 py-2 text-sm font-medium hover:bg-cyan-200 disabled:opacity-50"
          >
            Reporter
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-md bg-rose-100 text-rose-900 px-3 py-2 text-sm font-medium hover:bg-rose-200 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded-md bg-emerald-600 text-white px-3 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            Confirmer
          </button>
        </div>
      ) : order.status === 'confirmed' ? (
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="w-full rounded-md bg-rose-100 text-rose-900 px-3 py-2 text-sm font-medium hover:bg-rose-200 disabled:opacity-50"
        >
          Annuler la commande
        </button>
      ) : null}
    </div>
  )
}

