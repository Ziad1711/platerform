'use client'

import { ProductGalleryEditor, type GalleryItem } from './product-gallery-editor'

export type ProductVariantForm = {
  id?: string
  name: string
  sku: string
  selling_price: string
  purchase_cost: string
  old_price?: string
  stock_multiplier?: string | number
  is_default?: boolean
  sort_order?: number
  option_values?: Record<string, string>
  images?: GalleryItem[]
}

export const EMPTY_VARIANT: ProductVariantForm = {
  name: '',
  sku: '',
  selling_price: '',
  purchase_cost: '0',
  old_price: '',
  stock_multiplier: '1',
  is_default: false,
  sort_order: 0,
  images: [],
}

/** Éditeur de variantes partagé (création, édition, gestion des variantes). */
export function VariantEditor({
  variants,
  onChange,
  resolveUrl,
  error,
  withPurchaseCost = true,
}: {
  variants: ProductVariantForm[]
  onChange: (variants: ProductVariantForm[]) => void
  resolveUrl: (raw: string) => string | null
  error?: string
  withPurchaseCost?: boolean
}) {
  const list = variants || []

  const patch = (index: number, values: Partial<ProductVariantForm>) => {
    onChange(list.map((variant, i) => (i === index ? { ...variant, ...values } : variant)))
  }

  const setDefault = (index: number) => {
    onChange(list.map((variant, i) => ({ ...variant, is_default: i === index })))
  }

  const remove = (index: number) => {
    const next = list.filter((_, i) => i !== index)
    const hadDefault = Boolean(list[index]?.is_default)
    const withDefault =
      hadDefault && next.length > 0 ? next.map((v, i) => ({ ...v, is_default: i === 0 })) : next
    onChange(withDefault)
  }

  return (
    <div className="space-y-3">
      {list.map((variant, index) => (
        <div
          key={`variant-${variant.id || 'new'}-${index}`}
          className="space-y-3 rounded-lg border border-border bg-card p-3"
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.3fr_1fr_0.8fr_0.8fr_0.6fr_0.6fr]">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Nom variante</label>
              <input
                value={variant.name}
                onChange={(e) => patch(index, { name: e.target.value })}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="Ex: Noyer / 120 cm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">SKU variante</label>
              <input
                value={variant.sku}
                onChange={(e) => patch(index, { sku: e.target.value })}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="Ex: TABLE-001-NOYER-120"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Prix vente</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={variant.selling_price}
                onChange={(e) => patch(index, { selling_price: e.target.value })}
                className="w-full border rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Ancien prix</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={variant.old_price ?? ''}
                onChange={(e) => patch(index, { old_price: e.target.value })}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="Optionnel"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Qté / pack</label>
              <input
                type="number"
                min={1}
                step="1"
                value={variant.stock_multiplier ?? '1'}
                onChange={(e) => patch(index, { stock_multiplier: e.target.value })}
                className="w-full border rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Ordre</label>
              <input
                type="number"
                min={0}
                step="1"
                value={variant.sort_order ?? index}
                onChange={(e) => patch(index, { sort_order: Number(e.target.value) || 0 })}
                className="w-full border rounded-lg px-3 py-2"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {withPurchaseCost ? (
              <div className="w-40">
                <label className="mb-1 block text-xs text-muted-foreground">Coût achat</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={variant.purchase_cost}
                  onChange={(e) => patch(index, { purchase_cost: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => setDefault(index)}
              className={`rounded-lg border px-3 py-2 text-xs ${
                variant.is_default ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground'
              }`}
              title="Variante présélectionnée sur le site"
            >
              {variant.is_default ? '★ Variante par défaut' : '☆ Définir par défaut'}
            </button>

            <button
              type="button"
              onClick={() => remove(index)}
              className="rounded-lg border px-3 py-2 text-xs text-red-600"
            >
              Supprimer
            </button>
          </div>

          <ProductGalleryEditor
            label="Photos de la variante"
            compact
            items={variant.images || []}
            onChange={(images) => patch(index, { images })}
            resolveUrl={resolveUrl}
            helpText="Ces photos remplacent l’image produit lorsque le client sélectionne cette variante."
          />
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...list, { ...EMPTY_VARIANT, sort_order: list.length }])}
        className="text-sm text-primary hover:text-primary/80"
      >
        + Ajouter une variante
      </button>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
    </div>
  )
}
