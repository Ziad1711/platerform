'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Plus, X, Package } from 'lucide-react'

interface Product {
  id: string
  name: string
  default_selling_price?: number
  default_purchase_cost?: number
}

interface Variant {
  id: string
  product_id: string
  name: string
  selling_price?: number
  purchase_cost?: number
}

interface OrderItem {
  product_id: string
  product_variant_id: string | null
  quantity: number
  unit_selling_price: number
  products?: { name: string } | null
}

interface InlineEditProductsProps {
  items: OrderItem[]
  products: Product[]
  variantsByProductId: Record<string, Variant[]>
  onSave: (items: OrderItem[]) => void
  onClose: () => void
  triggerLabel?: string
}

export default function InlineEditProducts({
  items,
  products,
  variantsByProductId,
  onSave,
  onClose,
  triggerLabel,
}: InlineEditProductsProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [localItems, setLocalItems] = useState<OrderItem[]>([])
  const [openDropdownIndex, setOpenDropdownIndex] = useState<number | null>(null)
  const [productSearchTerms, setProductSearchTerms] = useState<string[]>([])
  const [addDropdownOpen, setAddDropdownOpen] = useState(false)
  const [addSearch, setAddSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const addSearchRef = useRef<HTMLInputElement>(null)
  const searchInputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Reset local state when modal opens
  const open = useCallback(() => {
    setLocalItems(
      items.length > 0
        ? items.map((item) => ({
            ...item,
            product_variant_id: item.product_variant_id || null,
          }))
        : []
    )
    setOpenDropdownIndex(null)
    setProductSearchTerms(
      items.length > 0
        ? items.map((item) => {
            const product = products.find((p) => p.id === item.product_id)
            return product?.name || ''
          })
        : []
    )
    setAddDropdownOpen(false)
    setAddSearch('')
    setIsOpen(true)
  }, [items])

  const close = useCallback(() => {
    setIsOpen(false)
    onClose()
  }, [onClose])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close()
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, close])

  // Focus search input when add dropdown opens
  useEffect(() => {
    if (addDropdownOpen && addSearchRef.current) {
      addSearchRef.current.focus()
    }
  }, [addDropdownOpen])

  const filteredProducts = useCallback(
    (search: string) => {
      if (!search) return products
      return products.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase())
      )
    },
    [products]
  )

  const handleSelectProduct = (index: number, productId: string) => {
    const product = products.find((p) => p.id === productId)
    const variants = variantsByProductId[productId] || []
    const firstVariant = variants[0]
    setLocalItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? {
              ...item,
              product_id: productId,
              product_variant_id: firstVariant?.id || null,
              unit_selling_price: Number(
                firstVariant?.selling_price ?? product?.default_selling_price ?? 0
              ),
            }
          : item
      )
    )
    setOpenDropdownIndex(null)
  }

  const handleSelectVariant = (index: number, variantId: string) => {
    setLocalItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item
        const variants = variantsByProductId[item.product_id] || []
        const variant = variants.find((v: any) => v.id === variantId)
        return {
          ...item,
          product_variant_id: variantId,
          unit_selling_price: Number(
            variant?.selling_price ?? item.unit_selling_price ?? 0
          ),
        }
      })
    )
  }

  const addProduct = (productId: string) => {
    const product = products.find((p) => p.id === productId)
    const variants = variantsByProductId[productId] || []
    const firstVariant = variants[0]
    setLocalItems((prev) => [
      ...prev,
      {
        product_id: productId,
        product_variant_id: firstVariant?.id || null,
        quantity: 1,
        unit_selling_price: Number(
          firstVariant?.selling_price ?? product?.default_selling_price ?? 0
        ),
      },
    ])
    setAddDropdownOpen(false)
    setAddSearch('')
  }

  const removeItem = (index: number) => {
    if (localItems.length <= 1) return
    setLocalItems((prev) => prev.filter((_, i) => i !== index))
  }

  const validItems = localItems.filter((item) => item.product_id && Number(item.quantity) > 0)

  // Products already selected (to exclude from add dropdown)
  // Only exclude products WITHOUT variants that are already present.
  // Products with variants remain selectable to allow adding different variations.
  const selectedProductIds = new Set(
    localItems
      .filter((item) => !(variantsByProductId[item.product_id]?.length > 0))
      .map((item) => item.product_id)
  )

  // Summary text shown when modal is closed
  const summary = items
    .map((item) => `${item.quantity}x ${item.products?.name || '?'}`)
    .join(', ')

  return (
    <>
      <button
        type="button"
        onDoubleClick={open}
        className="text-left text-[10px] sm:text-[11px] text-foreground hover:text-primary transition-colors cursor-default"
        title="Double-clic pour modifier"
      >
        {triggerLabel || summary || <span className="text-muted-foreground italic">Aucun produit</span>}
      </button>

      {isOpen && (
        <div
          ref={containerRef}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div className="absolute inset-0 bg-black/40" onClick={close} />
          <div className="relative z-10 w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-6 pt-6 pb-3">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-primary" />
                <h3 className="text-lg font-semibold text-foreground">Modifier les produits</h3>
              </div>
              <button
                type="button"
                onClick={close}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Fermer
              </button>
            </div>

            <div className="space-y-3 overflow-y-auto px-6 pb-3 flex-1">
              {localItems.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Aucun produit sélectionné. Ajoutez un produit ci-dessous.
                </p>
              )}

              {localItems.map((item, index) => {
                const variants = variantsByProductId[item.product_id] || []
                const product = products.find((p) => p.id === item.product_id)

                return (
                  <div
                    key={index}
                    className="rounded-xl border border-border bg-background p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        Produit {index + 1}
                      </span>
                      {localItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItem(index)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {/* Product selector: show name if selected, otherwise show search input */}
                    <div className="relative">
                      {item.product_id && product ? (
                        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
                          <span className="text-sm font-medium text-foreground">{product.name}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenDropdownIndex(openDropdownIndex === index ? null : index)
                              setProductSearchTerms((prev) =>
                                prev.map((term, i) => (i === index ? product.name : term))
                              )
                            }}
                            className="text-xs text-primary hover:underline"
                          >
                            Changer
                          </button>
                        </div>
                      ) : (
                        <input
                          ref={(el) => {
                            searchInputRefs.current[index] = el
                          }}
                          value={productSearchTerms[index] || ''}
                          onFocus={() => setOpenDropdownIndex(index)}
                          onChange={(e) => {
                            const value = e.target.value
                            setProductSearchTerms((prev) =>
                              prev.map((term, i) => (i === index ? value : term))
                            )
                            setOpenDropdownIndex(index)
                            setLocalItems((prev) =>
                              prev.map((row, i) =>
                                i === index
                                  ? { ...row, product_id: '', product_variant_id: null, unit_selling_price: 0 }
                                  : row
                              )
                            )
                          }}
                          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                          placeholder="Rechercher un produit..."
                        />
                      )}
                      {openDropdownIndex === index && (
                        <div className="absolute z-20 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
                          {products
                            .filter((p) =>
                              String(p.name || '')
                                .toLowerCase()
                                .includes(String(productSearchTerms[index] || '').toLowerCase())
                            )
                            .slice(0, 40)
                            .length === 0 ? (
                            <div className="px-3 py-2 text-sm text-muted-foreground">
                              Aucun produit trouvé
                            </div>
                          ) : (
                            products
                              .filter((p) =>
                                String(p.name || '')
                                  .toLowerCase()
                                  .includes(String(productSearchTerms[index] || '').toLowerCase())
                              )
                              .slice(0, 40)
                              .map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => {
                                    handleSelectProduct(index, p.id)
                                    setProductSearchTerms((prev) =>
                                      prev.map((term, i) => (i === index ? p.name : term))
                                    )
                                  }}
                                  className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary transition-colors ${
                                    item.product_id === p.id ? 'bg-secondary font-medium' : ''
                                  }`}
                                >
                                  {p.name}
                                </button>
                              ))
                          )}
                        </div>
                      )}
                    </div>

                    {/* Variant selector */}
                    {variants.length > 0 && (
                      <select
                        value={item.product_variant_id || ''}
                        onChange={(e) => handleSelectVariant(index, e.target.value)}
                        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                      >
                        <option value="">Choisir une variante</option>
                        {variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} — {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'MAD' }).format(v.selling_price || 0)}
                          </option>
                        ))}
                      </select>
                    )}

                    {/* Quantity & Price */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1">Quantité</label>
                        <input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(e) => {
                            const qty = Math.max(1, Number(e.target.value) || 1)
                            setLocalItems((prev) =>
                              prev.map((it, i) =>
                                i === index ? { ...it, quantity: qty } : it
                              )
                            )
                          }}
                          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1">
                          Prix unitaire
                        </label>
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={item.unit_selling_price}
                          onChange={(e) => {
                            const price = Math.max(0, Number(e.target.value) || 0)
                            setLocalItems((prev) =>
                              prev.map((it, i) =>
                                i === index ? { ...it, unit_selling_price: price } : it
                              )
                            )
                          }}
                          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                        />
                      </div>
                    </div>

                    {product && (
                      <div className="text-xs text-muted-foreground">
                        Total ligne :{' '}
                        {new Intl.NumberFormat('fr-FR', {
                          style: 'currency',
                          currency: 'MAD',
                        }).format(item.quantity * item.unit_selling_price)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Add product via dropdown */}
            <div className="px-6 pb-3 pt-1 relative">
              <button
                type="button"
                onClick={() => {
                  setAddDropdownOpen(!addDropdownOpen)
                  setAddSearch('')
                }}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-border py-2 text-sm text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
              >
                <Plus className="w-4 h-4" />
                Ajouter un produit
              </button>
              {addDropdownOpen && (
                <div className="absolute z-20 left-6 right-6 mt-1 rounded-lg border border-border bg-popover shadow-lg">
                  <div className="p-2">
                    <input
                      ref={addSearchRef}
                      type="text"
                      value={addSearch}
                      onChange={(e) => setAddSearch(e.target.value)}
                      placeholder="Chercher un produit..."
                      className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto">
                    {filteredProducts(addSearch).filter((p) => !selectedProductIds.has(p.id))
                      .length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        {addSearch
                          ? 'Aucun produit trouvé'
                          : 'Tous les produits disponibles sont déjà ajoutés'}
                      </div>
                    ) : (
                      filteredProducts(addSearch)
                        .filter((p) => !selectedProductIds.has(p.id))
                        .map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => addProduct(p.id)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-secondary transition-colors"
                          >
                            {p.name}
                          </button>
                        ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border px-6 pt-4 pb-6">
              <div className="text-sm font-medium text-foreground">
                Total :{' '}
                {new Intl.NumberFormat('fr-FR', {
                  style: 'currency',
                  currency: 'MAD',
                }).format(
                  localItems.reduce(
                    (sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_selling_price || 0),
                    0
                  )
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-secondary"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (validItems.length === 0) return
                    onSave(validItems)
                    close()
                  }}
                  disabled={validItems.length === 0}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
