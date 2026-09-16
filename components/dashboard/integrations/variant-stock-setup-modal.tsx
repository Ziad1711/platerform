'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

export type PendingVariantSetupProduct = {
  productId: string
  productName: string
  stockTrackingMode: 'shared' | 'variant'
  variants: Array<{
    id: string
    name: string
    sku: string
    sellingPrice: number
    stockMultiplier: number
  }>
}

type Props = {
  storeId: string
  products: PendingVariantSetupProduct[]
  onDone: () => void
}

/**
 * Étape de confirmation après l'import YouCan : les variantes qui ne sont pas des
 * variantes physiques (couleur, taille) mais des packs de quantité doivent indiquer
 * combien d'unités elles consomment, et si le stock est partagé avec le produit.
 */
export default function VariantStockSetupModal({ storeId, products, onDone }: Props) {
  const [index, setIndex] = useState(0)
  const [modes, setModes] = useState<Record<string, 'shared' | 'variant'>>(() =>
    Object.fromEntries(
      products.map((product) => [
        product.productId,
        product.stockTrackingMode === 'variant' ? 'variant' : 'shared',
      ])
    )
  )
  const [multipliers, setMultipliers] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      products.flatMap((product) =>
        product.variants.map((variant) => [variant.id, String(variant.stockMultiplier || 1)])
      )
    )
  )
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  const current = products[index]

  if (!current) {
    return null
  }

  const currentMode = modes[current.productId] ?? 'shared'
  const setCurrentMode = (next: 'shared' | 'variant') =>
    setModes((prev) => ({ ...prev, [current.productId]: next }))

  const submit = async (skip: boolean) => {
    if (skip) {
      if (index + 1 >= products.length) {
        onDone()
        return
      }
      setIndex(index + 1)
      return
    }

    setIsSaving(true)
    setError('')

    try {
      const response = await fetch('/api/integrations/youcan/variants/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId,
          productId: current.productId,
          stockTrackingMode: currentMode,
          variants: current.variants.map((variant) => ({
            id: variant.id,
            stockMultiplier: Number(multipliers[variant.id] || 1),
          })),
        }),
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error || 'Enregistrement impossible')
      }

      if (index + 1 >= products.length) {
        onDone()
      } else {
        setIndex(index + 1)
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Enregistrement impossible')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => (isSaving ? null : onDone())} />

      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Configuration des variantes</h3>
            <p className="text-sm text-muted-foreground">
              Indiquez combien d’unités chaque variante consomme ({index + 1}/{products.length})
            </p>
          </div>
          <button
            type="button"
            onClick={() => (isSaving ? null : onDone())}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-sm font-medium text-foreground">{current.productName}</p>

        <div className="mb-4 space-y-2">
          <label className="flex items-center gap-3 text-sm text-foreground">
            <input
              type="radio"
              name="stock-tracking-mode"
              checked={currentMode === 'shared'}
              onChange={() => setCurrentMode('shared')}
              disabled={isSaving}
            />
            Stock unique partagé (packs quantité)
          </label>
          <label className="flex items-center gap-3 text-sm text-foreground">
            <input
              type="radio"
              name="stock-tracking-mode"
              checked={currentMode === 'variant'}
              onChange={() => setCurrentMode('variant')}
              disabled={isSaving}
            />
            Stock séparé par variante (couleur, taille...)
          </label>
        </div>

        <div className="max-h-64 space-y-3 overflow-y-auto">
          {current.variants.map((variant) => (
            <div key={variant.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <div className="truncate text-sm text-foreground">{variant.name}</div>
                <div className="text-xs text-muted-foreground">
                  {formatCurrency(Number(variant.sellingPrice || 0))}
                  {variant.sku ? ` · ${variant.sku}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">×</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={multipliers[variant.id] ?? '1'}
                  onChange={(e) => setMultipliers((prev) => ({ ...prev, [variant.id]: e.target.value }))}
                  disabled={isSaving}
                  className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-sm"
                />
                <span className="text-xs text-muted-foreground">unités</span>
              </div>
            </div>
          ))}
        </div>

        {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void submit(true)}
            disabled={isSaving}
            className="rounded-xl border border-border px-4 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
          >
            Plus tard
          </button>
          <button
            type="button"
            onClick={() => void submit(false)}
            disabled={isSaving}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {isSaving ? 'Enregistrement...' : index + 1 >= products.length ? 'Terminer' : 'Enregistrer et continuer'}
          </button>
        </div>
      </div>
    </div>
  )
}
