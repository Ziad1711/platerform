'use client'

import { Plus, Trash2 } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import type {
  ConfirmationEditItem,
  ConfirmationProductOption,
  ConfirmationVariantOption,
} from '@/lib/confirmation/edit-types'

type OrderEditItemsProps = {
  items: ConfirmationEditItem[]
  products: ConfirmationProductOption[]
  variantsByProductId: Record<string, ConfirmationVariantOption[]>
  onChange: (items: ConfirmationEditItem[]) => void
}

export function createItemRowKey() {
  return `row-${Math.random().toString(36).slice(2, 10)}`
}

export function buildItemFromProduct(
  product: ConfirmationProductOption,
  variants: ConfirmationVariantOption[]
): ConfirmationEditItem {
  const firstVariant = variants[0] || null
  return {
    key: createItemRowKey(),
    productId: product.id,
    variantId: firstVariant ? firstVariant.id : null,
    quantity: 1,
    unitSellingPrice: Number(firstVariant?.selling_price ?? product.default_selling_price ?? 0),
  }
}

export default function OrderEditItems({
  items,
  products,
  variantsByProductId,
  onChange,
}: OrderEditItemsProps) {
  const updateItem = (index: number, patch: Partial<ConfirmationEditItem>) => {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  const handleProductChange = (index: number, productId: string) => {
    const product = products.find((candidate) => candidate.id === productId)
    if (!product) return

    const variants = variantsByProductId[productId] || []
    const firstVariant = variants[0] || null

    updateItem(index, {
      productId,
      variantId: firstVariant ? firstVariant.id : null,
      // Le nom personnalisé repart du nom catalogue du nouveau produit.
      productNameOverride: null,
      unitSellingPrice: Number(firstVariant?.selling_price ?? product.default_selling_price ?? 0),
    })
  }

  const handleVariantChange = (index: number, variantId: string) => {
    const item = items[index]
    const variant = (variantsByProductId[item.productId] || []).find((v) => v.id === variantId)
    updateItem(index, {
      variantId: variantId || null,
      unitSellingPrice:
        variant?.selling_price != null ? Number(variant.selling_price) : item.unitSellingPrice,
    })
  }

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index))
  }

  const addItem = () => {
    const usedProductIds = new Set(items.map((item) => item.productId))
    const available = products.find((product) => !usedProductIds.has(product.id)) || products[0]
    if (!available) return
    onChange([...items, buildItemFromProduct(available, variantsByProductId[available.id] || [])])
  }

  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.unitSellingPrice || 0),
    0
  )

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
          Aucun produit. Ajoutez au moins un produit avant de confirmer.
        </div>
      ) : null}

      {items.map((item, index) => {
        const variants = variantsByProductId[item.productId] || []
        const lineTotal = Number(item.quantity || 0) * Number(item.unitSellingPrice || 0)
        const catalogueName = item.productNameOverride == null
          ? products.find((product) => product.id === item.productId)?.name || ''
          : ''
        const displayName = item.productNameOverride ?? catalogueName

        return (
          <div key={item.key} className="rounded-lg border border-border p-3 space-y-2">
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
              <label className="text-xs text-muted-foreground space-y-1">
                <span>Produit</span>
                <select
                  value={item.productId}
                  onChange={(event) => handleProductChange(index, event.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                >
                  <option value="">— Choisir un produit —</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={() => removeItem(index)}
                className="self-end rounded-md border border-border p-2 text-rose-600 hover:bg-rose-50"
                title="Supprimer ce produit"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            {variants.length > 0 ? (
              <label className="text-xs text-muted-foreground space-y-1 block">
                <span>Variante</span>
                <select
                  value={item.variantId || ''}
                  onChange={(event) => handleVariantChange(index, event.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                >
                  <option value="">— Choisir une variante —</option>
                  {variants.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="text-xs text-muted-foreground space-y-1 block">
              <span>Nom affiché dans la commande</span>
              <input
                type="text"
                value={displayName}
                onChange={(event) => updateItem(index, { productNameOverride: event.target.value })}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              />
              <span className="block text-[11px] text-muted-foreground">
                Le produit reste lié à son identifiant catalogue : stock, variante et prix d’achat
                ne changent pas.
              </span>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-muted-foreground space-y-1">
                <span>Quantité</span>
                <input
                  type="number"
                  min={1}
                  value={item.quantity}
                  onChange={(event) =>
                    updateItem(index, { quantity: Number(event.target.value) || 0 })
                  }
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                />
              </label>
              <label className="text-xs text-muted-foreground space-y-1">
                <span>Prix unitaire</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={item.unitSellingPrice}
                  onChange={(event) =>
                    updateItem(index, { unitSellingPrice: Number(event.target.value) || 0 })
                  }
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                />
              </label>
            </div>

            <div className="text-xs text-muted-foreground text-right">
              Total ligne : {formatCurrency(lineTotal)}
            </div>
          </div>
        )
      })}

      <button
        type="button"
        onClick={addItem}
        disabled={products.length === 0}
        className="w-full rounded-lg border border-dashed border-border py-2 text-sm text-muted-foreground hover:border-primary hover:text-foreground disabled:opacity-50"
      >
        <span className="inline-flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Ajouter un produit
        </span>
      </button>

      <div className="text-sm font-medium text-foreground text-right">
        Sous-total : {formatCurrency(subtotal)}
      </div>
    </div>
  )
}

