'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  AlertTriangle,
  Loader2,
  MapPin,
  Package,
  PackageCheck,
  Phone,
  StickyNote,
  Truck,
  User,
  Wallet,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import type { ConfirmationOrder } from '@/lib/confirmation/types'

export type ConfirmDeliveryChoice = {
  deliveryMode: 'internal' | 'shipping'
  deliveryCompanyId: string | null
  deliveryNote: string
}

type ConfirmOrderDialogProps = {
  open: boolean
  order: ConfirmationOrder | null
  busy: boolean
  canEdit: boolean
  onClose: () => void
  onEdit: () => void
  onSubmit: (choice: ConfirmDeliveryChoice) => void
}

type DeliveryCompanyOption = { id: string; name: string; is_active: boolean | null }

function SectionTitle({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {icon}
      {label}
    </div>
  )
}

function renderProducts(order: ConfirmationOrder | null) {
  const items = order?.order_items || []
  if (items.length === 0) return <div className="text-sm text-muted-foreground">Aucun produit</div>

  return (
    <ul className="divide-y divide-border">
      {items.map((item, index) => {
        const name = item.product_name_override || item.products?.name || 'Produit'
        const variantName = item.product_variants?.name || null
        const quantity = Number(item.quantity || 0)
        const unitPrice = item.unit_selling_price != null ? Number(item.unit_selling_price) : null

        return (
          <li
            key={`${name}-${variantName || 'no-variant'}-${index}`}
            className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <span className="mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-muted px-1.5 text-xs font-semibold text-foreground">
              ×{quantity}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-foreground">{name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Variante :{' '}
                <span className={variantName ? 'font-medium text-foreground' : ''}>
                  {variantName || '—'}
                </span>
              </div>
            </div>
            {unitPrice != null ? (
              <div className="shrink-0 text-sm font-medium text-foreground">
                {formatCurrency(unitPrice)}
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

export default function ConfirmOrderDialog({
  open,
  order,
  busy,
  canEdit,
  onClose,
  onEdit,
  onSubmit,
}: ConfirmOrderDialogProps) {
  const supabase = useMemo(() => createClient(), [])
  const storeId = order?.store_id || null

  const [deliveryChoice, setDeliveryChoice] = useState('')
  const [deliveryNote, setDeliveryNote] = useState('')
  const [localError, setLocalError] = useState('')

  const { data: deliveryCompanies = [] } = useQuery<DeliveryCompanyOption[]>({
    queryKey: ['confirmation-confirm-delivery-companies', storeId],
    enabled: open && Boolean(storeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('delivery_companies')
        .select('id, name, is_active')
        .eq('store_id', storeId as string)
        .order('name', { ascending: true })

      if (error) throw error
      return (data || []) as DeliveryCompanyOption[]
    },
  })

  useEffect(() => {
    if (!open) return
    setDeliveryNote(order?.delivery_note || '')
    setLocalError('')
    // Une société déjà rattachée reste sélectionnée ; sinon l'agent doit choisir.
    setDeliveryChoice(order?.delivery_company_id ? String(order.delivery_company_id) : '')
  }, [open, order])

  const missingPhone = !String(order?.phone || '').trim()
  const missingCity = !String(order?.city || '').trim()
  const hasProducts = (order?.order_items || []).length > 0
  const isShipping = deliveryChoice !== '' && deliveryChoice !== 'internal'
  const willCreateParcel = isShipping && !order?.tracking_number

  const handleSubmit = () => {
    if (missingPhone) {
      setLocalError('Le numéro de téléphone est obligatoire pour confirmer.')
      return
    }
    if (missingCity) {
      setLocalError('La ville est obligatoire pour confirmer.')
      return
    }
    if (!hasProducts) {
      setLocalError('La commande doit contenir au moins un produit.')
      return
    }
    if (!deliveryChoice) {
      setLocalError('Choisissez la livraison interne ou une société de livraison.')
      return
    }

    onSubmit({
      deliveryMode: deliveryChoice === 'internal' ? 'internal' : 'shipping',
      deliveryCompanyId: deliveryChoice === 'internal' ? null : deliveryChoice,
      deliveryNote: deliveryNote.trim(),
    })
  }

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <DialogHeader className="gap-3 border-b border-border bg-muted/40 px-6 py-4 pr-14">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <PackageCheck className="h-5 w-5" />
            </span>
            <div className="space-y-1">
              <DialogTitle className="text-base font-semibold">Confirmer la commande</DialogTitle>
              <DialogDescription className="text-xs">
                Vérifiez les informations avant validation. Une commande confirmée sort de la file
                de confirmation.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6 py-4 text-sm text-foreground">
          <section className="space-y-3 rounded-xl border border-border p-4">
            <SectionTitle icon={<User className="h-3.5 w-3.5" />} label="Client" />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{order?.customer_name || 'Client inconnu'}</span>
              {order?.phone ? (
                <a
                  href={`tel:${order.phone}`}
                  className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {order.phone}
                </a>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Téléphone manquant
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {order?.city || 'Ville manquante'}
              </span>
              {order?.address ? (
                <span className="inline-flex items-center gap-1.5">
                  <StickyNote className="h-3.5 w-3.5" />
                  {order.address}
                </span>
              ) : null}
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-border p-4">
            <SectionTitle icon={<Package className="h-3.5 w-3.5" />} label="Produits" />
            {renderProducts(order)}
          </section>

          <section className="space-y-3 rounded-xl border border-border p-4">
            <SectionTitle icon={<Wallet className="h-3.5 w-3.5" />} label="Montant" />
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-2xl font-semibold">
                {formatCurrency(Number(order?.total_selling_price || 0))}
              </span>
              {Number(order?.delivery_charge_to_customer || 0) > 0 ? (
                <span className="text-xs text-muted-foreground">
                  + livraison {formatCurrency(Number(order?.delivery_charge_to_customer || 0))}
                </span>
              ) : null}
              {Number(order?.rounding_adjustment || 0) > 0 ? (
                <span className="text-xs font-medium text-primary">
                  Arrondi + {formatCurrency(Number(order?.rounding_adjustment || 0))}
                </span>
              ) : null}
            </div>
          </section>

          {order?.is_blacklisted ? (
            <section className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Ce numéro est blacklisté. Confirmez uniquement si vous avez vérifié la commande.
              </span>
            </section>
          ) : null}

          <section className="space-y-4 rounded-xl border border-border p-4">
            <SectionTitle icon={<Truck className="h-3.5 w-3.5" />} label="Livraison" />

            <label className="block space-y-1 text-sm">
              <span className="font-medium">Société de livraison *</span>
              <select
                value={deliveryChoice}
                onChange={(event) => {
                  setDeliveryChoice(event.target.value)
                  setLocalError('')
                }}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— Choisir —</option>
                <option value="internal">Livraison interne</option>
                {deliveryCompanies
                  .filter((company) => company.is_active !== false)
                  .map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
              </select>
            </label>

            <label className="block space-y-1 text-sm">
              <span className="font-medium">Note de livraison (facultatif)</span>
              <textarea
                value={deliveryNote}
                onChange={(event) => setDeliveryNote(event.target.value)}
                rows={2}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          </section>

          {willCreateParcel ? (
            <section className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <Truck className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                La confirmation créera immédiatement le colis chez le transporteur sélectionné.
              </span>
            </section>
          ) : null}

          {localError ? (
            <section className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{localError}</span>
            </section>
          ) : null}
        </div>

        <DialogFooter className="gap-2 border-t border-border bg-muted/40 px-6 py-4 sm:justify-end">
          {canEdit ? (
            <Button variant="outline" onClick={onEdit} disabled={busy} className="sm:mr-auto">
              Modifier la commande
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Fermer
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
            {busy ? 'Confirmation...' : 'Confirmer la commande'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
