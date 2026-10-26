'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Plus, X, Package, Pencil, Loader2 } from 'lucide-react'

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
  /** Nom affiché dans la commande (le product_id reste inchangé) */
  product_name_override?: string | null
}

interface InlineEditProductsProps {
  items: OrderItem[]
  products: Product[]
  variantsByProductId: Record<string, Variant[]>
  onSave: (items: OrderItem[]) => void
  onClose: () => void
  triggerLabel?: string
  /** Signale l'ouverture au parent : les catalogues ne sont lus qu'à ce moment. */
  onOpenChange?: (open: boolean) => void
  /** Catalogues en cours de lecture : aucune modification dépendante n'est permise. */
  catalogLoading?: boolean
  /** Échec de lecture des catalogues : message réel affiché, enregistrement bloqué. */
  catalogError?: string | null
  onRetryCatalog?: () => void
}

export default function InlineEditProducts({
  items,
  products,
  variantsByProductId,
  onSave,
  onClose,
  triggerLabel,
  onOpenChange,
  catalogLoading = false,
  catalogError = null,
  onRetryCatalog,
}: InlineEditProductsProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [localItems, setLocalItems] = useState<OrderItem[]>([])
  const [openDropdownIndex, setOpenDropdownIndex] = useState<number | null>(null)
  const [productSearchTerms, setProductSearchTerms] = useState<string[]>([])
  const [addDropdownOpen, setAddDropdownOpen] = useState(false)
  const [addSearch, setAddSearch] = useState('')
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const addSearchRef = useRef<HTMLInputElement>(null)
  const searchInputRefs = useRef<(HTMLInputElement | null)[]>([])
  const productRowRefs = useRef<(HTMLDivElement | null)[]>([])

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
    onOpenChange?.(true)
  }, [items, products, onOpenChange])

  const close = useCallback(() => {
    setIsOpen(false)
    onOpenChange?.(false)
    onClose()
  }, [onClose, onOpenChange])

  // Une ligne peut disparaître (pagination, filtre, changement de boutique) alors
  // que l'éditeur est ouvert : le parent est prévenu au démontage, afin de ne pas
  // laisser un catalogue actif sans consommateur. Un `close()` explicite a déjà
  // remis `isOpen` à false, donc aucun signal n'est envoyé deux fois.
  const isOpenRef = useRef(false)
  const onOpenChangeRef = useRef(onOpenChange)
  useEffect(() => {
    isOpenRef.current = isOpen
    onOpenChangeRef.current = onOpenChange
  })
  useEffect(() => {
    return () => {
      if (isOpenRef.current) onOpenChangeRef.current?.(false)
    }
  }, [])

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

  // Calculate fixed position for product dropdown based on input element
  const openProductDropdown = useCallback((index: number) => {
    setOpenDropdownIndex(index)
    // Fallback sur la ligne produit : quand un produit est déjà sélectionné,
    // l'input de recherche n'est pas rendu dans le DOM.
    const el = searchInputRefs.current[index] || productRowRefs.current[index]
    if (el) {
      const rect = el.getBoundingClientRect()
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      })
    }
  }, [])

  // Close dropdown and reset position
  const closeProductDropdown = useCallback(() => {
    setOpenDropdownIndex(null)
    setDropdownPos(null)
  }, [])

  // Reposition dropdown on scroll/resize
  useEffect(() => {
    if (openDropdownIndex === null) return
    const handleReposition = () => {
      const el = searchInputRefs.current[openDropdownIndex] || productRowRefs.current[openDropdownIndex]
      if (el) {
        const rect = el.getBoundingClientRect()
        setDropdownPos({
          top: rect.bottom + 4,
          left: rect.left,
          width: rect.width,
        })
      }
    }
    window.addEventListener('scroll', handleReposition, true)
    window.addEventListener('resize', handleReposition)
    return () => {
      window.removeEventListener('scroll', handleReposition, true)
      window.removeEventListener('resize', handleReposition)
    }
  }, [openDropdownIndex])

  const filteredProducts = useCallback(
    (search: string) => {
      if (!search) return products
      return products.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase())
      )
    },
    [products]
  )

  // Tant que le catalogue n'est pas disponible, aucune sélection de produit ni
  // enregistrement n'est permis ; les lignes existantes restent affichées.
  const catalogBlocked = catalogLoading || !!catalogError

  const handleSelectProduct = (index: number, productId: string) => {
    if (catalogBlocked) return
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
              product_name_override: null,
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
    if (catalogBlocked) return
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
    if (catalogBlocked) return
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

  // On ne persiste un nom personnalisé que s'il diffère vraiment du nom catalogue :
  // le champ est pré-rempli par défaut avec le nom du produit.
  const itemsToSave = validItems.map((item) => {
    const catalogueName = String(products.find((p) => p.id === item.product_id)?.name || '').trim()
    const override = String(item.product_name_override || '').trim()
    return { ...item, product_name_override: override && override !== catalogueName ? override : null }
  })

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
    .map((item) => `${item.quantity}x ${item.product_name_override || item.products?.name || '?'}`)
    .join(', ')

  return (
    <>
      <button
        type="button"
        onClick={open}
        onDoubleClick={open}
        className="group text-left text-[10px] sm:text-[11px] text-foreground hover:text-primary transition-colors cursor-pointer"
        title="Cliquer pour modifier"
      >
        {triggerLabel || summary || <span className="text-muted-foreground italic">Aucun produit</span>}
        <span
          role="button"
          onClick={(e) => {
            e.stopPropagation()
            open()
          }}
          className="ml-1 inline-block cursor-pointer p-0.5 align-middle text-muted-foreground/60 hover:text-primary transition-colors"
          title="Modifier"
        >
          <Pencil className="inline-block h-3.5 w-3.5 align-middle" />
        </span>
      </button>

      {isOpen && typeof document !== 'undefined'
        ? createPortal(
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
              {catalogLoading ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Chargement du catalogue produits et variantes de cette boutique…
                </div>
              ) : null}
              {catalogError ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <span>{catalogError}</span>
                  {onRetryCatalog ? (
                    <button
                      type="button"
                      onClick={onRetryCatalog}
                      className="shrink-0 rounded-md border border-red-200 px-2 py-1 font-medium hover:bg-red-100 transition-colors"
                    >
                      Réessayer
                    </button>
                  ) : null}
                </div>
              ) : null}
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
                      {item.product_id && !product && catalogBlocked ? (
                        <div className="flex h-10 items-center truncate rounded-lg border border-border bg-secondary/40 px-3 text-sm text-muted-foreground">
                          {item.product_name_override || 'Produit lié — catalogue en cours de chargement'}
                        </div>
                      ) : item.product_id && product ? (
                        <div
                          ref={(el) => {
                            productRowRefs.current[index] = el
                          }}
                          className="flex items-center justify-between rounded-lg border border-border bg-card h-10 px-3"
                        >
                          <span className="text-sm font-medium text-foreground truncate">{item.product_name_override || product.name}</span>
                          <button
                            type="button"
                            onClick={() => {
                              if (openDropdownIndex === index) {
                                closeProductDropdown()
                                setProductSearchTerms((prev) =>
                                  prev.map((term, i) => (i === index ? product.name : term))
                                )
                                return
                              }
                              // Vider la recherche pour afficher toute la liste des produits
                              setProductSearchTerms((prev) =>
                                prev.map((term, i) => (i === index ? '' : term))
                              )
                              openProductDropdown(index)
                            }}
                            className="text-xs text-primary hover:underline shrink-0 ml-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={catalogBlocked}
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
                          onFocus={() => openProductDropdown(index)}
                          onChange={(e) => {
                            const value = e.target.value
                            setProductSearchTerms((prev) =>
                              prev.map((term, i) => (i === index ? value : term))
                            )
                            openProductDropdown(index)
                            setLocalItems((prev) =>
                              prev.map((row, i) =>
                                i === index
                                  ? { ...row, product_id: '', product_variant_id: null, unit_selling_price: 0 }
                                  : row
                              )
                            )
                          }}
                          className="w-full rounded-lg border border-border bg-card px-3 h-10 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                          placeholder="Rechercher un produit..."
                          disabled={catalogBlocked}
                        />
                      )}
                      {openDropdownIndex === index && dropdownPos && (
                        <>
                          <div className="fixed inset-0 z-[9998]" onClick={() => closeProductDropdown()} />
                          <div
                            className="fixed z-[9999] max-h-40 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg"
                            style={{
                              top: dropdownPos.top,
                              left: dropdownPos.left,
                              width: dropdownPos.width,
                            }}
                          >
                            {products
                              .filter((p) =>
                                String(p.name || '')
                                  .toLowerCase()
                                  .includes(String(productSearchTerms[index] || '').toLowerCase())
                              )
                              .slice(0, 40)
                              .length === 0 ? (
                              <div className="px-3 py-2.5 text-sm text-muted-foreground">
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
                                    className={`w-full text-left px-3 py-2.5 text-sm hover:bg-secondary transition-colors ${
                                      item.product_id === p.id ? 'bg-secondary font-medium' : ''
                                    }`}
                                  >
                                    {p.name}
                                  </button>
                                ))
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Nom affiché dans la commande (product_id inchangé) */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <label className="block text-[11px] font-medium text-muted-foreground leading-none">
                          Nom dans la commande
                        </label>
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                          <Pencil className="h-3 w-3" />
                          Modifiable
                        </span>
                      </div>
                      <input
                        type="text"
                        value={item.product_name_override ?? product?.name ?? ''}
                        onChange={(e) => {
                          const value = e.target.value
                          setLocalItems((prev) =>
                            prev.map((it, i) =>
                              i === index ? { ...it, product_name_override: value } : it
                            )
                          )
                        }}
                        placeholder="Nom du produit"
                        className="w-full rounded-lg border border-dashed border-primary/50 bg-card px-3 h-10 text-sm text-foreground transition-colors hover:border-primary focus:border-solid focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Cliquez pour renommer. Le produit lié (stock, coûts, variantes) reste inchangé.
                      </p>
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
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-6">
                        <label className="block text-[11px] font-medium text-muted-foreground leading-none mb-1.5">Quantité</label>
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
                          className="w-full rounded-lg border border-border bg-card px-3 h-10 text-sm"
                        />
                      </div>
                      <div className="col-span-6">
                        <label className="block text-[11px] font-medium text-muted-foreground leading-none mb-1.5">
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
                          className="w-full rounded-lg border border-border bg-card px-3 h-10 text-sm"
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
                  if (catalogBlocked) return
                  setAddDropdownOpen(!addDropdownOpen)
                  setAddSearch('')
                }}
                disabled={catalogBlocked}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-border py-2 text-sm text-muted-foreground hover:text-foreground hover:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                    if (catalogBlocked) return
                    if (itemsToSave.length === 0) return
                    onSave(itemsToSave)
                    close()
                  }}
                  disabled={itemsToSave.length === 0 || catalogBlocked}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        </div>,
          document.body,
        )
        : null}
    </>
  )
}
