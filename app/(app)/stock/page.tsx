'use client'

import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import StoreSelector from '@/components/dashboard/store-selector'
import { JisraMark } from '@/components/logo'
import { Search, Filter, MoreVertical, Package, ArrowDown, ArrowUp, RefreshCw, Plus, Info, DollarSign } from 'lucide-react'

import { useEffect, useMemo, useState } from 'react'

export default function StocksPage() {
  const PAGE_SIZE = 10
  const { currentStoreId, accessibleStoreIds, accessibleStores: stores } = useStore()
  const [search, setSearch] = useState('')
  const [movementType, setMovementType] = useState<string>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [showAdjustmentInfo, setShowAdjustmentInfo] = useState(false)
  const [selectedCreateStoreId, setSelectedCreateStoreId] = useState('')
  const [selectedSupplierId, setSelectedSupplierId] = useState('')
  const [newProductId, setNewProductId] = useState('')
  const [newVariantId, setNewVariantId] = useState('')
  const [newMovementType, setNewMovementType] = useState<'in' | 'adjustment'>('in')
  const [newAdjustmentDirection, setNewAdjustmentDirection] = useState<'in' | 'out'>('out')
  const [newQuantity, setNewQuantity] = useState('1')
  const [newUnitCost, setNewUnitCost] = useState('')
  const [newInvoiceNumber, setNewInvoiceNumber] = useState('')
  const [createError, setCreateError] = useState('')
  const supabase = createClient()
  const queryClient = useQueryClient()

  const { data: productsForCreate } = useQuery({
    queryKey: ['stock-products-for-create-movement', selectedCreateStoreId],
    enabled: !!selectedCreateStoreId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, sku')
        .eq('store_id', selectedCreateStoreId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data || []
    },
  })

  const { data: variantsForSelectedProduct } = useQuery({
    queryKey: ['stock-variants-for-selected-product', selectedCreateStoreId, newProductId],
    enabled: !!selectedCreateStoreId && !!newProductId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_variants')
        .select('id, name, sku')
        .eq('store_id', selectedCreateStoreId)
        .eq('product_id', newProductId)
        .order('created_at', { ascending: true })

      if (error) throw error
      return data || []
    },
  })

  const { data: suppliersForCreate } = useQuery({
    queryKey: ['stock-suppliers-for-create-movement', selectedCreateStoreId],
    enabled: !!selectedCreateStoreId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('id, name')
        .eq('store_id', selectedCreateStoreId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data || []
    },
  })

  useEffect(() => {
    if (!isCreateOpen) return
    if (currentStoreId) {
      setSelectedCreateStoreId(currentStoreId)
      return
    }
    if ((stores || []).length === 1) {
      setSelectedCreateStoreId(stores?.[0]?.id || '')
    }
  }, [isCreateOpen, currentStoreId, stores])

  useEffect(() => {
    if (!productsForCreate?.length) {
      setNewProductId('')
      setNewVariantId('')
      return
    }
    if (!newProductId || !productsForCreate.some((p: any) => p.id === newProductId)) {
      setNewProductId(productsForCreate[0].id)
    }
  }, [productsForCreate, newProductId])

  useEffect(() => {
    if (!newProductId) {
      setNewVariantId('')
      return
    }

    if (!variantsForSelectedProduct?.length) {
      setNewVariantId('')
      return
    }

    if (!newVariantId || !variantsForSelectedProduct.some((v: any) => v.id === newVariantId)) {
      setNewVariantId(variantsForSelectedProduct[0].id)
    }
  }, [newProductId, variantsForSelectedProduct, newVariantId])

  const createMovementMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCreateStoreId) throw new Error('Veuillez sélectionner un store.')
      if (!newProductId) throw new Error('Veuillez sélectionner un produit.')
      if ((variantsForSelectedProduct || []).length > 0 && !newVariantId) {
        throw new Error('Veuillez sélectionner une variante pour ce produit.')
      }

      const quantity = Number(newQuantity || 0)
      const unitCost = Number(newUnitCost || 0)

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('La quantité doit être supérieure à 0.')
      }

      if (!Number.isFinite(unitCost) || unitCost < 0) {
        throw new Error('Le coût unitaire doit être positif.')
      }

      const effectiveUnitCost = unitCost
      const totalCost = quantity * effectiveUnitCost

      const { error } = await supabase
        .from('inventory_movements')
        .insert({
          store_id: selectedCreateStoreId,
          product_id: newProductId,
          product_variant_id: newVariantId || null,
          movement_type: newMovementType,
          adjustment_direction: newMovementType === 'adjustment' ? newAdjustmentDirection : null,
          supplier_id: selectedSupplierId || null,
          quantity,
          remaining_qty: newMovementType === 'in' ? quantity : null,
          unit_cost: effectiveUnitCost,
          total_cost: totalCost,
          invoice_number: newInvoiceNumber.trim() || null,
        })

      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['inventory-movements-details'] }),
        queryClient.invalidateQueries({ queryKey: ['stock-summary'] }),
      ])
      setIsCreateOpen(false)
      setNewMovementType('in')
      setNewAdjustmentDirection('out')
      setNewVariantId('')
      setSelectedSupplierId('')
      setNewQuantity('1')
      setNewUnitCost('')
      setNewInvoiceNumber('')
      setCreateError('')
    },
    onError: (error: any) => {
      setCreateError(error?.message || 'Erreur lors de la création du mouvement.')
    },
  })

  const { data: movementsResponse, isLoading } = useQuery({
    queryKey: ['inventory-movements-details', currentStoreId, search, movementType, currentPage],
    queryFn: async () => {
      if (!currentStoreId && accessibleStoreIds.length === 0) {
        return { data: [], count: 0 }
      }

      let query = supabase
        .from('inventory_movements')
        .select(`
          *,
          products(name, sku),
          suppliers(name)
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((currentPage - 1) * PAGE_SIZE, (currentPage * PAGE_SIZE) - 1)

      if (currentStoreId) {
        query = query.eq('store_id', currentStoreId)
      } else {
        query = query.in('store_id', accessibleStoreIds)
      }

      if (search.trim()) {
        const term = search.trim()

        let productsSearchQuery = supabase
          .from('products')
          .select('id')
          .or(`name.ilike.%${term}%,sku.ilike.%${term}%`)

        if (currentStoreId) {
          productsSearchQuery = productsSearchQuery.eq('store_id', currentStoreId)
        } else {
          productsSearchQuery = productsSearchQuery.in('store_id', accessibleStoreIds)
        }

        const { data: matchedProducts, error: matchedProductsError } = await productsSearchQuery
        if (matchedProductsError) throw matchedProductsError

        const matchedProductIds = (matchedProducts || []).map((p: any) => p.id)

        if (matchedProductIds.length > 0) {
          query = query.or(`invoice_number.ilike.%${term}%,product_id.in.(${matchedProductIds.join(',')})`)
        } else {
          query = query.ilike('invoice_number', `%${term}%`)
        }
      }

      if (movementType !== 'all') {
        query = query.eq('movement_type', movementType)
      }

      const { data, error, count } = await query

      if (error) throw error
      return {
        data: data || [],
        count: count || 0,
      }
    },
  })

  const movements = movementsResponse?.data || []

  useEffect(() => {
    setCurrentPage(1)
  }, [currentStoreId, search, movementType])

  const orderSourceIds = useMemo(
    () => Array.from(new Set((movements || [])
      .filter((m: any) => ['order', 'order_return'].includes(String(m.source_type || '')) && m.source_id)
      .map((m: any) => m.source_id))),
    [movements]
  )

  const { data: ordersById } = useQuery({
    queryKey: ['stock-orders-by-id', orderSourceIds],
    enabled: orderSourceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, customer_name, status')
        .in('id', orderSourceIds)

      if (error) throw error
      return Object.fromEntries((data || []).map((order: any) => [order.id, order])) as Record<string, any>
    },
  })

  const supplierIds = useMemo(
    () => Array.from(new Set((movements || []).filter((m: any) => m.supplier_id).map((m: any) => m.supplier_id))),
    [movements]
  )

  const variantIds = useMemo(
    () => Array.from(new Set((movements || []).filter((m: any) => m.product_variant_id).map((m: any) => m.product_variant_id))),
    [movements]
  )

  const { data: suppliersById } = useQuery({
    queryKey: ['stock-suppliers-by-id', supplierIds],
    enabled: supplierIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('id, name')
        .in('id', supplierIds)

      if (error) throw error
      return Object.fromEntries((data || []).map((supplier: any) => [supplier.id, supplier])) as Record<string, any>
    },
  })

  const { data: variantsById } = useQuery({
    queryKey: ['stock-variants-by-id', variantIds],
    enabled: variantIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_variants')
        .select('id, name, sku')
        .in('id', variantIds)

      if (error) throw error
      return Object.fromEntries((data || []).map((variant: any) => [variant.id, variant])) as Record<string, any>
    },
  })

  const { data: stockSummary } = useQuery({
    queryKey: ['stock-summary', currentStoreId],
    queryFn: async () => {
      if (!currentStoreId && accessibleStoreIds.length === 0) {
        return { totalValue: 0, outOfStockCount: 0, finalStockUnits: 0 }
      }

      // Récupérer tous les produits
      let productsQuery = supabase
        .from('products')
        .select('id, name, default_purchase_cost')

      if (currentStoreId) {
        productsQuery = productsQuery.eq('store_id', currentStoreId)
      } else {
        productsQuery = productsQuery.in('store_id', accessibleStoreIds)
      }

      const { data: products, error: productsError } = await productsQuery

      if (productsError) throw productsError

      // Récupérer tous les mouvements
      let allMovementsQuery = supabase
        .from('inventory_movements')
        .select('product_id, movement_type, adjustment_direction, quantity')

      if (currentStoreId) {
        allMovementsQuery = allMovementsQuery.eq('store_id', currentStoreId)
      } else {
        allMovementsQuery = allMovementsQuery.in('store_id', accessibleStoreIds)
      }

      const { data: allMovements, error: movementsError } = await allMovementsQuery

      if (movementsError) throw movementsError

      // Calculer le stock pour chaque produit
      const stockByProduct: Record<string, number> = {}
      allMovements?.forEach(movement => {
        const productId = movement.product_id
        if (!stockByProduct[productId]) {
          stockByProduct[productId] = 0
        }
        
        if (
          movement.movement_type === 'in' ||
          (movement.movement_type === 'adjustment' && movement.adjustment_direction === 'in')
        ) {
          stockByProduct[productId] += movement.quantity
        } else if (
          movement.movement_type === 'out' ||
          (movement.movement_type === 'adjustment' && movement.adjustment_direction === 'out')
        ) {
          stockByProduct[productId] -= movement.quantity
        }
      })

      // Calculer les statistiques
      let totalValue = 0
      let outOfStockCount = 0
      let finalStockUnits = 0

      products?.forEach(product => {
        const stock = stockByProduct[product.id] || 0
        totalValue += stock * product.default_purchase_cost
        finalStockUnits += stock
        
        if (stock === 0) {
          outOfStockCount++
        }
      })

      return { totalValue, outOfStockCount, finalStockUnits }
    },
  })

  const totalMovements = movementsResponse?.count || 0
  const totalPages = Math.max(1, Math.ceil(totalMovements / PAGE_SIZE))
  const totalIn = movements?.reduce((sum, m) => {
    if (m.movement_type === 'in') return sum + m.quantity
    if (m.movement_type === 'adjustment' && m.adjustment_direction === 'in') return sum + m.quantity
    return sum
  }, 0) || 0
  const totalOut = movements?.reduce((sum, m) => {
    if (m.movement_type === 'out') return sum + m.quantity
    if (m.movement_type === 'adjustment' && m.adjustment_direction === 'out') return sum + m.quantity
    return sum
  }, 0) || 0

  return (
    <div className="space-y-6 pt-2 sm:pt-0">

      <div className="flex flex-col items-center sm:items-start gap-1">
        <div className="flex items-center gap-2">
          <JisraMark size={28} />
          <span className="text-lg font-bold text-[#1fa971] bg-[#1fa971]/10 px-3 py-1 rounded-full">
            Stock
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Gestion des stocks et mouvements
        </p>
      </div>

      {/* Filters - same row as sales */}
      <div className="bg-card rounded-xl shadow p-4">
        <div className="flex flex-row items-center gap-4 sm:gap-5">
          <StoreSelector />
          <div className="flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
            <select
              className="border rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
              value={movementType}
              onChange={(e) => setMovementType(e.target.value)}
            >
              <option value="all">Tous</option>
              <option value="in">Entrées</option>
              <option value="out">Sorties</option>
              <option value="adjustment">Ajustements</option>
            </select>
          </div>
        </div>
      </div>

      {showAdjustmentInfo ? (


        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 text-white flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-card/20 flex items-center justify-center">
                <Info className="w-5 h-5" />
              </div>
              <div>
                <div className="font-semibold">Mouvement d’ajustement</div>
                <div className="text-xs text-white/90">Explication rapide</div>
              </div>
            </div>
            <div className="p-6 space-y-3 text-sm text-foreground">
              <p>
                Un <span className="font-semibold text-foreground">ajustement</span> sert à corriger un écart entre le stock système et le stock réel.
              </p>
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
                <p className="text-blue-900">
                  Exemple : inventaire physique = 18 unités, système = 20 unités → vous faites un ajustement de -2.
                </p>
              </div>
              <p className="text-muted-foreground">
                Les sorties normales de stock sont créées automatiquement via les commandes.
              </p>
            </div>
            <div className="px-6 pb-6">
              <button
                type="button"
                onClick={() => setShowAdjustmentInfo(false)}
                className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-2.5 rounded-lg"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isCreateOpen ? (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="p-6 border-b flex items-center justify-between shrink-0 bg-card">
              <h3 className="text-lg font-semibold text-foreground">Nouveau mouvement de stock</h3>
              <button type="button" onClick={() => setIsCreateOpen(false)} className="text-muted-foreground hover:text-foreground">
                Fermer
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm text-foreground mb-1">Store</label>
                  <select
                    value={selectedCreateStoreId}
                    onChange={(e) => setSelectedCreateStoreId(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="">Choisir un store</option>
                    {(stores || []).map((store: any) => (
                      <option key={store.id} value={store.id}>
                        {store.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm text-foreground mb-1">Produit</label>
                  <select
                    value={newProductId}
                    onChange={(e) => {
                      setNewProductId(e.target.value)
                      setNewVariantId('')
                    }}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="">Choisir un produit</option>
                    {(productsForCreate || []).map((product: any) => (
                      <option key={product.id} value={product.id}>
                        {product.name} {product.sku ? `(${product.sku})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm text-foreground mb-1">Variante</label>
                  <select
                    value={newVariantId}
                    onChange={(e) => setNewVariantId(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                    disabled={!newProductId || !(variantsForSelectedProduct || []).length}
                  >
                    <option value="">
                      {(variantsForSelectedProduct || []).length > 0
                        ? 'Choisir une variante'
                        : 'Aucune variante (produit simple)'}
                    </option>
                    {(variantsForSelectedProduct || []).map((variant: any) => (
                      <option key={variant.id} value={variant.id}>
                        {variant.name} {variant.sku ? `(${variant.sku})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="block text-sm text-foreground">Fournisseur (optionnel)</label>
                    <button
                      type="button"
                      onClick={() => {
                        const storeId = selectedCreateStoreId || currentStoreId || ''
                        const targetUrl = storeId
                          ? `/dashboard/fournisseurs?openCreate=1&storeId=${encodeURIComponent(storeId)}`
                          : '/dashboard/fournisseurs?openCreate=1'
                        window.open(targetUrl, '_blank', 'noopener,noreferrer')
                      }}
                      className="text-xs text-primary hover:text-primary/80"
                    >
                      + Ajouter un fournisseur
                    </button>
                  </div>
                  <select
                    value={selectedSupplierId}
                    onChange={(e) => setSelectedSupplierId(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="">Aucun fournisseur</option>
                    {(suppliersForCreate || []).map((supplier: any) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-foreground mb-1">Type de mouvement</label>
                  <select
                    value={newMovementType}
                    onChange={(e) => {
                      const value = e.target.value as 'in' | 'adjustment'
                      setNewMovementType(value)
                      if (value === 'adjustment') {
                        setShowAdjustmentInfo(true)
                      }
                    }}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="in">Entrée</option>
                    <option value="adjustment">Ajustement</option>
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Les sorties sont générées automatiquement via les commandes. Ici, vous pouvez seulement faire une entrée ou un ajustement.
                  </p>
                </div>

                {newMovementType === 'adjustment' ? (
                  <div>
                    <label className="block text-sm text-foreground mb-1">Sens d'ajustement</label>
                    <select
                      value={newAdjustmentDirection}
                      onChange={(e) => setNewAdjustmentDirection(e.target.value as 'in' | 'out')}
                      className="w-full border rounded-lg px-3 py-2"
                    >
                      <option value="in">Ajustement entrée (+)</option>
                      <option value="out">Ajustement sortie (-)</option>
                    </select>
                  </div>
                ) : null}

                <div>
                  <label className="block text-sm text-foreground mb-1">Quantité</label>
                  <input
                    type="number"
                    min={1}
                    step="1"
                    value={newQuantity}
                    onChange={(e) => setNewQuantity(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm text-foreground mb-1">Coût unitaire</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={newUnitCost}
                    onChange={(e) => setNewUnitCost(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm text-foreground mb-1">N° facture (optionnel)</label>
                  <input
                    value={newInvoiceNumber}
                    onChange={(e) => setNewInvoiceNumber(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="Ex: FAC-2026-001"
                  />
                </div>
              </div>

              {createError ? <div className="text-sm text-red-600">{createError}</div> : null}
            </div>

            <div className="p-6 border-t flex items-center justify-end gap-3 shrink-0 bg-card">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="px-4 py-2 rounded-lg border text-foreground"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => createMovementMutation.mutate()}
                disabled={createMovementMutation.isPending}
                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white disabled:opacity-50"
              >
                {createMovementMutation.isPending ? 'Création...' : 'Créer le mouvement'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
        <div className="col-span-2 md:col-span-1 bg-card rounded-xl shadow p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs sm:text-sm text-muted-foreground">Valeur totale du stock</div>
            <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />

          </div>
          <div className="text-lg sm:text-2xl font-bold text-foreground mt-1">
            {formatCurrency(stockSummary?.totalValue || 0)}
          </div>
        </div>

        <div className="bg-card rounded-xl shadow p-4 sm:p-5">
          <div className="text-xs sm:text-sm text-muted-foreground">Mouvements total</div>
          <div className="text-lg sm:text-2xl font-bold text-foreground mt-1">{totalMovements}</div>
        </div>
        <div className="bg-card rounded-xl shadow p-4 sm:p-5">
          <div className="text-xs sm:text-sm text-muted-foreground">Produits en rupture</div>
          <div className="text-lg sm:text-2xl font-bold text-red-600 mt-1">{stockSummary?.outOfStockCount || 0}</div>
        </div>

      </div>

      {/* Movement Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-card rounded-xl shadow p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs sm:text-sm text-muted-foreground">Entrées de stock</div>
            <ArrowDown className="w-4 h-4 sm:w-5 sm:h-5 text-green-500" />
          </div>
          <div className="text-lg sm:text-2xl font-bold text-foreground mt-1">{totalIn} unités</div>
          <div className="text-xs sm:text-sm text-muted-foreground mt-1 sm:mt-2">
            {movements?.filter(m => m.movement_type === 'in' || (m.movement_type === 'adjustment' && m.adjustment_direction === 'in')).length || 0} mouvements
          </div>
        </div>
        <div className="bg-card rounded-xl shadow p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs sm:text-sm text-muted-foreground">Sorties de stock</div>
            <ArrowUp className="w-4 h-4 sm:w-5 sm:h-5 text-red-500" />
          </div>
          <div className="text-lg sm:text-2xl font-bold text-foreground mt-1">{totalOut} unités</div>
          <div className="text-xs sm:text-sm text-muted-foreground mt-1 sm:mt-2">
            {movements?.filter(m => m.movement_type === 'out' || (m.movement_type === 'adjustment' && m.adjustment_direction === 'out')).length || 0} mouvements
          </div>
        </div>
        <div className="col-span-2 md:col-span-1 bg-card rounded-xl shadow p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs sm:text-sm text-muted-foreground">Stock finale</div>
            <Package className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500" />
          </div>
          <div className="text-lg sm:text-2xl font-bold text-foreground mt-1">{stockSummary?.finalStockUnits || 0} unités</div>
          <div className="text-xs sm:text-sm text-muted-foreground mt-1 sm:mt-2">Entrées - sorties (stock net actuel)</div>
        </div>
      </div>

      {/* Search & Actions */}
      <div className="bg-card rounded-xl shadow p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative min-w-[220px]">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Rechercher par produit ou numéro de facture..."
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={() => {
              setCreateError('')
              setSelectedCreateStoreId(currentStoreId || '')
              setSelectedSupplierId('')
              setNewVariantId('')
              setNewMovementType('in')
              setNewAdjustmentDirection('out')
              setNewQuantity('1')
              setNewUnitCost('')
              setNewInvoiceNumber('')
              setIsCreateOpen(true)
            }}
            className="inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Ajouter un mouvement
          </button>
        </div>
      </div>

      {/* Movements Table */}
      <div className="bg-card rounded-xl shadow overflow-hidden">

        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-muted-foreground mt-2">Chargement des mouvements...</p>
            </div>
          ) : movements.length > 0 ? (
            <table className="w-full table-auto divide-y divide-border">
              <thead className="bg-secondary">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Produit
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Variante
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Quantité
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Coût unitaire
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Total
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Fournisseur
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Source
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-card divide-y divide-border">
                {movements.map((movement) => {
                  const linkedOrder = movement.source_id ? ordersById?.[movement.source_id] : null
                  const linkedSupplier = movement.supplier_id ? suppliersById?.[movement.supplier_id] : null
                  const linkedVariant = movement.product_variant_id ? variantsById?.[movement.product_variant_id] : null
                  return (
                  <tr key={movement.id} className="hover:bg-secondary">
                    <td className="px-6 py-4 text-sm text-muted-foreground align-top">
                      {formatDateTime(movement.created_at)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-foreground">{movement.products?.name}</div>
                      <div className="text-sm text-muted-foreground">{movement.products?.sku || 'Pas de SKU'}</div>
                    </td>
                    <td className="px-6 py-4 align-top">
                      <div className="text-sm text-foreground">{linkedVariant?.name || '-'}</div>
                      <div className="text-xs text-muted-foreground">{linkedVariant?.sku || ''}</div>
                    </td>
                    <td className="px-6 py-4 align-top">
                      <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        movement.movement_type === 'in' 
                          ? 'bg-green-100 text-green-800' 
                          : movement.movement_type === 'out'
                          ? 'bg-red-100 text-red-800'
                          : movement.adjustment_direction === 'in'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {movement.movement_type === 'in' ? (
                          <ArrowDown className="w-3 h-3 mr-1" />
                        ) : movement.movement_type === 'out' ? (
                          <ArrowUp className="w-3 h-3 mr-1" />
                        ) : (
                          <RefreshCw className="w-3 h-3 mr-1" />
                        )}
                        {movement.movement_type === 'in'
                          ? 'Entrée'
                          : movement.movement_type === 'out'
                          ? 'Sortie'
                          : movement.adjustment_direction === 'in'
                          ? 'Ajustement entrée'
                          : 'Ajustement sortie'}
                      </div>
                    </td>
                    <td className="px-6 py-4 align-top">
                      <div className={`text-sm font-medium ${
                        movement.movement_type === 'in' || (movement.movement_type === 'adjustment' && movement.adjustment_direction === 'in')
                          ? 'text-green-600'
                          : 'text-red-600'
                      }`}>
                        {movement.movement_type === 'in' || (movement.movement_type === 'adjustment' && movement.adjustment_direction === 'in') ? '+' : '-'}{movement.quantity}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground align-top">
                      {formatCurrency(movement.unit_cost || 0)}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-foreground align-top">
                      {formatCurrency(movement.total_cost || 0)}
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground align-top">
                      {linkedSupplier?.name || movement.suppliers?.name || '-'}
                      {movement.invoice_number && (
                        <div className="text-xs text-muted-foreground">Facture: {movement.invoice_number}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground align-top">
                      {movement.source_type === 'order' && linkedOrder ? (
                        <div>
                          <div className="text-foreground">Commande #{String(linkedOrder.id || '').slice(0, 8)}</div>
                          <div className="text-xs text-muted-foreground">{linkedOrder.customer_name || '-'} • {linkedOrder.status || '-'}</div>
                        </div>
                      ) : movement.source_type === 'order_return' && linkedOrder ? (
                        <div>
                          <div className="text-foreground">Retour #{String(linkedOrder.id || '').slice(0, 8)}</div>
                          <div className="text-xs text-muted-foreground">{linkedOrder.customer_name || '-'} • {linkedOrder.status || '-'}</div>
                        </div>
                      ) : movement.source_type ? (
                        <span>{movement.source_type}</span>
                      ) : (
                        <span>-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium align-top">
                      <button className="text-primary hover:text-blue-900 mr-3">
                        Détails
                      </button>
                      <button className="text-muted-foreground hover:text-muted-foreground">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center">
              <div className="text-muted-foreground mb-4">Aucun mouvement de stock trouvé</div>
              <p className="text-muted-foreground">
                {search || movementType !== 'all' ? 'Essayez de modifier vos filtres' : 'Enregistrez votre premier mouvement de stock'}
              </p>
            </div>
          )}
        </div>

        {totalMovements > 0 ? (
          <div className="border-t px-6 py-4 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Page {currentPage} / {totalPages} • {totalMovements} mouvements
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded-md border text-sm text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Précédent
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="px-3 py-1.5 rounded-md border text-sm text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Suivant
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}