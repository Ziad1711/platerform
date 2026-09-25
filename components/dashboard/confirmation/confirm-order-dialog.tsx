'use client'

import { useEffect, useMemo, useState } from 'react'
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

function renderProducts(order: ConfirmationOrder | null) {
  const items = order?.order_items || []
  if (items.length === 0) return <div className="text-muted-foreground">Aucun produit</div>

  return (
    <ul className="space-y-1">
      {items.map((item, index) => (
        <li key={`${item.product_name_override || item.products?.name || 'item'}-${index}`}>
          {Number(item.quantity || 0)} × {item.product_name_override || item.products?.name || 'Produit'}
          {item.unit_selling_price
            ? ` — ${formatCurrency(Number(item.unit_selling_price || 0))}`
            : ''}
        </li>
      ))}
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirmer la commande</DialogTitle>
          <DialogDescription>
            Vérifiez les informations avant validation. Une commande confirmée sort de la file de
            confirmation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm text-foreground">
          <div className="rounded-lg border border-border p-3 space-y-1">
            <div className="text-muted-foreground text-xs">Client</div>
            <div className="font-medium">{order?.customer_name || '-'}</div>
            <div>Téléphone : {order?.phone || '-'}</div>
            <div>Ville : {order?.city || '-'}</div>
            {order?.address ? <div>Adresse : {order.address}</div> : null}
          </div>

          <div className="rounded-lg border border-border p-3 space-y-1">
            <div className="text-muted-foreground text-xs">Produits</div>
            {renderProducts(order)}
          </div>

          <div className="rounded-lg border border-border p-3 space-y-1">
            <div className="text-muted-foreground text-xs">Montant</div>
            <div className="font-semibold">{formatCurrency(Number(order?.total_selling_price || 0))}</div>
            {Number(order?.delivery_charge_to_customer || 0) > 0 ? (
              <div className="text-muted-foreground">
                Livraison facturée : {formatCurrency(Number(order?.delivery_charge_to_customer || 0))}
              </div>
            ) : null}
          </div>

          {order?.is_blacklisted ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 text-xs">
              Ce numéro est blacklisté. Confirmez uniquement si vous avez vérifié la commande.
            </div>
          ) : null}

          <div className="rounded-lg border border-border p-3 space-y-3">
            <div className="text-muted-foreground text-xs">Livraison</div>

            <label className="text-sm space-y-1 block">
              <span>Société de livraison *</span>
              <select
                value={deliveryChoice}
                onChange={(event) => {
                  setDeliveryChoice(event.target.value)
                  setLocalError('')
                }}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
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

            <label className="text-sm space-y-1 block">
              <span>Note de livraison (facultatif)</span>
              <textarea
                value={deliveryNote}
                onChange={(event) => setDeliveryNote(event.target.value)}
                rows={2}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>

          {willCreateParcel ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800 text-xs">
              La confirmation créera immédiatement le colis chez le transporteur sélectionné.
            </div>
          ) : null}

          {localError ? <div className="text-sm text-rose-600">{localError}</div> : null}
        </div>

        <DialogFooter className="gap-2">
          {canEdit ? (
            <Button variant="outline" onClick={onEdit} disabled={busy}>
              Modifier la commande
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Fermer
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? 'Confirmation...' : 'Confirmer la commande'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
