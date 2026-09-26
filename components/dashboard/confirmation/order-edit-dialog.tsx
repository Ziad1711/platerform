'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
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
import OrderEditItems, { createItemRowKey } from './order-edit-items'
import type {
  ConfirmationEditItem,
  ConfirmationProductOption,
  ConfirmationVariantOption,
} from '@/lib/confirmation/edit-types'
import type { ConfirmationOrder } from '@/lib/confirmation/types'

type OrderEditDialogProps = {
  open: boolean
  order: ConfirmationOrder | null
  onClose: () => void
  onSaved: () => void
}

type CustomerForm = {
  customerName: string
  phone: string
  address: string
  city: string
}

export default function OrderEditDialog({ open, order, onClose, onSaved }: OrderEditDialogProps) {
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()
  const storeId = order?.store_id || null

  const [customer, setCustomer] = useState<CustomerForm>({
    customerName: '',
    phone: '',
    address: '',
    city: '',
  })
  const [items, setItems] = useState<ConfirmationEditItem[]>([])
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState('')

  const { data: products = [] } = useQuery<ConfirmationProductOption[]>({
    queryKey: ['confirmation-edit-products', storeId],
    enabled: open && Boolean(storeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, default_selling_price, default_purchase_cost')
        .eq('store_id', storeId as string)
        .order('name', { ascending: true })

      if (error) throw error
      return (data || []) as ConfirmationProductOption[]
    },
  })

  const { data: variantsByProductId = {} } = useQuery<
    Record<string, ConfirmationVariantOption[]>
  >({
    queryKey: ['confirmation-edit-variants', storeId],
    enabled: open && Boolean(storeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_variants')
        .select('id, product_id, name, selling_price, purchase_cost')
        .eq('store_id', storeId as string)
        .order('created_at', { ascending: true })

      if (error) throw error

      const grouped: Record<string, ConfirmationVariantOption[]> = {}
      for (const variant of (data || []) as ConfirmationVariantOption[]) {
        const key = String(variant.product_id)
        if (!grouped[key]) grouped[key] = []
        grouped[key].push(variant)
      }
      return grouped
    },
  })

  useEffect(() => {
    if (!open || !order) return

    setCustomer({
      customerName: order.customer_name || '',
      phone: order.phone || '',
      address: order.address || '',
      city: order.city || '',
    })
    setLocalError('')

    setItems(
      (order.order_items || [])
        .filter((item) => Boolean(item.product_id))
        .map((item) => ({
          key: createItemRowKey(),
          productId: String(item.product_id),
          variantId: item.product_variant_id || null,
          quantity: Number(item.quantity || 1),
          unitSellingPrice: Number(item.unit_selling_price || 0),
          productNameOverride: item.product_name_override || null,
          itemType: item.item_type || 'product',
        }))
    )
  }, [open, order])

  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.unitSellingPrice || 0),
    0
  )
  const deliveryCharge = Number(order?.delivery_charge_to_customer || 0)
  const hasVariants = Object.keys(variantsByProductId).length > 0

  const handleSave = async () => {
    if (!order) return

    if (!customer.customerName.trim()) {
      setLocalError('Le nom du client est obligatoire.')
      return
    }
    if (!customer.phone.trim()) {
      setLocalError('Le numéro de téléphone est obligatoire.')
      return
    }
    if (!customer.city.trim()) {
      setLocalError('La ville est obligatoire.')
      return
    }
    if (items.length === 0) {
      setLocalError('Ajoutez au moins un produit.')
      return
    }
    if (items.some((item) => !item.productId || Number(item.quantity) <= 0)) {
      setLocalError('Chaque produit doit avoir une quantité supérieure à zéro.')
      return
    }
    if (items.some((item) => hasVariants && (variantsByProductId[item.productId] || []).length > 0 && !item.variantId)) {
      setLocalError('Chaque produit avec variantes doit avoir une variante sélectionnée.')
      return
    }

    setSaving(true)
    setLocalError('')

    try {
      const response = await fetch('/api/orders/confirmation/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          customer: {
            customerName: customer.customerName.trim(),
            phone: customer.phone.trim(),
            address: customer.address.trim(),
            city: customer.city.trim(),
          },
          items: items.map((item) => {
            // Le nom personnalisé n'est enregistré que s'il diffère du catalogue :
            // `product_id` reste toujours celui du produit d'origine.
            const catalogueName = String(
              products.find((product) => product.id === item.productId)?.name || ''
            ).trim()
            const override = String(item.productNameOverride ?? '').trim()
            const productNameOverride = override && override !== catalogueName ? override : null

            return {
              productId: item.productId,
              productVariantId: item.variantId,
              quantity: Number(item.quantity),
              unitSellingPrice: Number(item.unitSellingPrice),
              productNameOverride,
              itemType: item.itemType || 'product',
            }
          }),
        }),
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'CONFIRMATION_DETAILS_UPDATE_FAILED')
      }

      await queryClient.invalidateQueries({ queryKey: ['confirmation-queue'] })
      await queryClient.invalidateQueries({ queryKey: ['confirmation-history', order.id] })
      await queryClient.invalidateQueries({ queryKey: ['orders'] })
      toast.success('Commande mise à jour.')
      onSaved()
      onClose()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'CONFIRMATION_DETAILS_UPDATE_FAILED'
      if (message.includes('ORDER_ALREADY_SHIPPED')) {
        setLocalError('Un colis existe déjà pour cette commande : modification impossible.')
      } else if (message.includes('ORDER_NOT_EDITABLE')) {
        setLocalError('Cette commande est déjà confirmée ou annulée.')
      } else {
        setLocalError(message)
      }
    } finally {
      setSaving(false)
    }
  }


  return (
    <Dialog open={open} onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Modifier la commande</DialogTitle>
          <DialogDescription>
            Corrigez les informations client et les produits. Le transporteur est choisi au moment
            de la confirmation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Informations client</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-muted-foreground space-y-1">
                <span>Nom du client *</span>
                <input
                  type="text"
                  value={customer.customerName}
                  onChange={(event) =>
                    setCustomer((current) => ({ ...current, customerName: event.target.value }))
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="text-xs text-muted-foreground space-y-1">
                <span>Téléphone *</span>
                <input
                  type="text"
                  inputMode="tel"
                  value={customer.phone}
                  onChange={(event) =>
                    setCustomer((current) => ({ ...current, phone: event.target.value }))
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="text-xs text-muted-foreground space-y-1">
                <span>Ville *</span>
                <input
                  type="text"
                  value={customer.city}
                  onChange={(event) =>
                    setCustomer((current) => ({ ...current, city: event.target.value }))
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="text-xs text-muted-foreground space-y-1 sm:col-span-2">
                <span>Adresse</span>
                <textarea
                  rows={2}
                  value={customer.address}
                  onChange={(event) =>
                    setCustomer((current) => ({ ...current, address: event.target.value }))
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Produits</h3>
            <OrderEditItems
              items={items}
              products={products}
              variantsByProductId={variantsByProductId}
              onChange={setItems}
            />
          </section>


          <div className="rounded-lg border border-border p-3 text-sm space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Sous-total</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            {deliveryCharge > 0 ? (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Livraison facturée</span>
                <span>{formatCurrency(deliveryCharge)}</span>
              </div>
            ) : null}
            <div className="flex items-center justify-between font-semibold text-foreground">
              <span>Montant à encaisser</span>
              <span>{formatCurrency(subtotal + deliveryCharge)}</span>
            </div>
          </div>

          {localError ? <div className="text-sm text-rose-600">{localError}</div> : null}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Fermer
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Enregistrement...' : 'Enregistrer les modifications'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

