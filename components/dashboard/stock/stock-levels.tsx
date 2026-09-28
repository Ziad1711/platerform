'use client'

import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'
import { Fragment, useMemo, useState } from 'react'
import { Search, ChevronDown, ChevronRight, Boxes } from 'lucide-react'
import { cn } from '@/lib/utils'
import StoreSelector from '@/components/dashboard/store-selector'

/**
 * Delta appliqué au stock par un mouvement d'inventaire (lecture seule).
 * Reproduction exacte de la règle utilisée ailleurs (products, catalogue) :
 * entrée = +qty, sortie = -qty, ajustement selon son sens.
 */
function resolveDelta(movement: any): number {
  const quantity = Number(movement.quantity || 0)
  if (movement.movement_type === 'in') return quantity
  if (movement.movement_type === 'out') return -quantity
  if (movement.movement_type === 'adjustment') {
    return movement.adjustment_direction === 'out' ? -quantity : quantity
  }
  return 0
}

/**
 * Vue "Stock actuel" : stock physique par produit et par variante,
 * calculé à partir de TOUS les mouvements du store (jamais depuis la page
 * courante ni depuis remaining_qty qui sert au FIFO). Aucune écriture ici.
 */
export function StockLevels() {
  const { currentStoreId, accessibleStoreIds, accessibleStores } = useStore()
  const supabase = createClient()
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const hasScope = !!currentStoreId || accessibleStoreIds.length > 0

  const storeNameById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const store of accessibleStores || []) {
      map[store.id] = store.name
    }
    return map
  }, [accessibleStores])

  const { data: products, isLoading } = useQuery({
    queryKey: ['stock-levels-products', currentStoreId],
    enabled: hasScope,
    queryFn: async () => {
      let query = supabase
        .from('products')
        .select('id, name, sku, store_id, stock_tracking_mode')
        .order('name')

      if (currentStoreId) query = query.eq('store_id', currentStoreId)
      else query = query.in('store_id', accessibleStoreIds)

      const { data, error } = await query
      if (error) throw error
      return (data || []) as any[]
    },
  })

  const { data: variants } = useQuery({
    queryKey: ['stock-levels-variants', currentStoreId],
    enabled: hasScope,
    queryFn: async () => {
      let query = supabase
        .from('product_variants')
        .select('id, name, sku, product_id, stock_multiplier')

      if (currentStoreId) query = query.eq('store_id', currentStoreId)
      else query = query.in('store_id', accessibleStoreIds)

      const { data, error } = await query
      if (error) throw error
      return (data || []) as any[]
    },
  })

  const { data: movements } = useQuery({
    queryKey: ['stock-levels-movements', currentStoreId],
    enabled: hasScope,
    queryFn: async () => {
      let query = supabase
        .from('inventory_movements')
        .select('product_id, product_variant_id, movement_type, adjustment_direction, quantity')

      if (currentStoreId) query = query.eq('store_id', currentStoreId)
      else query = query.in('store_id', accessibleStoreIds)

      const { data, error } = await query
      if (error) throw error
      return (data || []) as any[]
    },
  })

  const stock = useMemo(() => {
    const productStock: Record<string, number> = {}
    const variantStock: Record<string, number> = {}
    const unassignedStock: Record<string, number> = {}

    for (const movement of movements || []) {
      const productId = String(movement.product_id || '')
      if (!productId) continue

      const delta = resolveDelta(movement)
      productStock[productId] = (productStock[productId] || 0) + delta

      const variantId = String(movement.product_variant_id || '')
      if (variantId) {
        variantStock[variantId] = (variantStock[variantId] || 0) + delta
      } else {
        unassignedStock[productId] = (unassignedStock[productId] || 0) + delta
      }
    }

    return { productStock, variantStock, unassignedStock }
  }, [movements])

  const variantsByProduct = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const variant of variants || []) {
      const productId = String(variant.product_id || '')
      if (!productId) continue
      if (!map[productId]) map[productId] = []
      map[productId].push(variant)
    }
    return map
  }, [variants])

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return products || []

    return (products || []).filter((product: any) => {
      if ((product.name || '').toLowerCase().includes(term)) return true
      if ((product.sku || '').toLowerCase().includes(term)) return true
      return (variantsByProduct[product.id] || []).some(
        (variant: any) =>
          (variant.name || '').toLowerCase().includes(term) ||
          (variant.sku || '').toLowerCase().includes(term)
      )
    })
  }, [products, search, variantsByProduct])

  if (!hasScope) {
    return (
      <div className="bg-card rounded-xl shadow p-8 text-center text-muted-foreground">
        Aucun store accessible.
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="bg-card rounded-xl shadow p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        <p className="text-muted-foreground mt-2">Chargement du stock...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl shadow p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <StoreSelector />
          <div className="flex-1 relative min-w-[220px]">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Rechercher un produit ou une variante..."
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="bg-card rounded-xl shadow overflow-hidden">
        <div className="overflow-x-auto">
          {filteredProducts.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {search ? 'Aucun produit ne correspond à la recherche.' : 'Aucun produit.'}
            </div>
          ) : (
            <table className="w-full table-auto divide-y divide-border">
              <thead className="bg-secondary">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Produit
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Store
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Stock physique
                  </th>
                  <th className="px-6 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product: any) => {
                  const productId = product.id
                  const mode = String(product.stock_tracking_mode || 'variant')
                  const total = stock.productStock[productId] || 0
                  const productVariants = variantsByProduct[productId] || []
                  const isExpanded = !!expanded[productId]
                  const hasVariants = productVariants.length > 0
                  const unassigned = stock.unassignedStock[productId] || 0

                  return (
                    <Fragment key={productId}>
                      <tr className="hover:bg-muted/30">
                        <td className="px-6 py-4 align-top">
                          <div className="text-sm font-medium text-foreground">{product.name}</div>
                          <div className="text-xs text-muted-foreground">{product.sku || '—'}</div>
                        </td>
                        <td className="px-6 py-4 text-sm text-muted-foreground align-top">
                          {storeNameById[product.store_id] || '—'}
                        </td>
                        <td className="px-6 py-4 text-right align-top">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 text-sm font-semibold',
                              total < 0
                                ? 'text-red-600'
                                : total === 0
                                ? 'text-muted-foreground'
                                : 'text-foreground'
                            )}
                          >
                            <Boxes className="w-4 h-4" />
                            {total}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right align-top">
                          {hasVariants ? (
                            <button
                              type="button"
                              onClick={() =>
                                setExpanded((prev) => ({ ...prev, [productId]: !prev[productId] }))
                              }
                              className="text-muted-foreground hover:text-foreground"
                              aria-label={isExpanded ? 'Replier' : 'Déplier'}
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </button>
                          ) : null}
                        </td>
                      </tr>

                      {isExpanded ? (
                        <tr>
                          <td colSpan={4} className="px-6 pb-4 pt-0 bg-muted/20">
                            <div className="rounded-lg border divide-y divide-border">
                              {productVariants.map((variant: any) => {
                                const variantId = variant.id
                                const multiplier = Math.max(Number(variant.stock_multiplier || 1), 1)
                                const ownStock = stock.variantStock[variantId] || 0
                                const sellable =
                                  mode === 'shared' ? Math.floor(total / multiplier) : ownStock

                                return (
                                  <div
                                    key={variantId}
                                    className="px-4 py-2.5 flex items-center justify-between gap-3"
                                  >
                                    <div className="min-w-0">
                                      <div className="text-sm text-foreground">{variant.name}</div>
                                      <div className="text-xs text-muted-foreground">
                                        {variant.sku || '—'}
                                      </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                      {mode === 'shared' ? (
                                        <>
                                          <div className="text-sm font-medium text-foreground">
                                            {sellable} vendable(s)
                                          </div>
                                          <div className="text-xs text-muted-foreground">
                                            pack ×{multiplier} · stock partagé {total}
                                          </div>
                                        </>
                                      ) : (
                                        <>
                                          <div
                                            className={cn(
                                              'text-sm font-medium',
                                              ownStock < 0 ? 'text-red-600' : 'text-foreground'
                                            )}
                                          >
                                            {ownStock}
                                          </div>
                                          {multiplier > 1 ? (
                                            <div className="text-xs text-muted-foreground">
                                              pack ×{multiplier}
                                            </div>
                                          ) : null}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}

                              {mode === 'variant' && unassigned !== 0 ? (
                                <div className="px-4 py-2.5 flex items-center justify-between gap-3 bg-amber-50/50">
                                  <div className="text-sm text-amber-800">Non affecté à une variante</div>
                                  <div className="text-sm font-medium text-amber-800">{unassigned}</div>
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

