'use client'

import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatCurrency } from '@/lib/utils'
import StoreSelector from '@/components/dashboard/store-selector'
import { useSearchParams } from 'next/navigation'
import { Search, Plus, MoreVertical } from 'lucide-react'
import { Suspense, useEffect, useMemo, useState } from 'react'

function FournisseursPageContent() {
  const PAGE_SIZE = 10
  const { currentStoreId, accessibleStoreIds, accessibleStores: stores } = useStore()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [selectedCreateStoreId, setSelectedCreateStoreId] = useState('')
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [createError, setCreateError] = useState('')
  const [hasHandledOpenCreateParam, setHasHandledOpenCreateParam] = useState(false)

  const { data: suppliersResponse, isLoading } = useQuery({
    queryKey: ['suppliers', currentStoreId, search, currentPage],
    queryFn: async () => {
      if (!currentStoreId && accessibleStoreIds.length === 0) {
        return { data: [], count: 0 }
      }

      let query = supabase
        .from('suppliers')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((currentPage - 1) * PAGE_SIZE, (currentPage * PAGE_SIZE) - 1)

      if (currentStoreId) {
        query = query.eq('store_id', currentStoreId)
      } else {
        query = query.in('store_id', accessibleStoreIds)
      }

      if (search.trim()) {
        const term = search.trim()
        query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%`)
      }

      const { data, error, count } = await query
      if (error) throw error
      return {
        data: data || [],
        count: count || 0,
      }
    },
  })

  useEffect(() => {
    setCurrentPage(1)
  }, [currentStoreId, search])

  const { data: purchasesBySupplier } = useQuery({
    queryKey: ['suppliers-purchases-summary', currentStoreId],
    queryFn: async () => {
      if (!currentStoreId && accessibleStoreIds.length === 0) {
        return {}
      }

      let query = supabase
        .from('inventory_movements')
        .select('supplier_id, quantity, total_cost')
        .eq('movement_type', 'in')

      if (currentStoreId) {
        query = query.eq('store_id', currentStoreId)
      } else {
        query = query.in('store_id', accessibleStoreIds)
      }

      const { data, error } = await query
      if (error) throw error

      const summary: Record<string, { quantity: number; amount: number }> = {}
      ;(data || []).forEach((movement: any) => {
        const supplierId = String(movement.supplier_id || '')
        if (!supplierId) return

        if (!summary[supplierId]) {
          summary[supplierId] = { quantity: 0, amount: 0 }
        }

        summary[supplierId].quantity += Number(movement.quantity || 0)
        summary[supplierId].amount += Number(movement.total_cost || 0)
      })

      return summary
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
    if (hasHandledOpenCreateParam) return

    const shouldOpenCreate = searchParams.get('openCreate') === '1'
    if (!shouldOpenCreate) return

    setCreateError('')
    setNewName('')
    setNewPhone('')
    setNewNotes('')

    const storeIdFromQuery = searchParams.get('storeId') || ''
    if (storeIdFromQuery) {
      setSelectedCreateStoreId(storeIdFromQuery)
    } else if (currentStoreId) {
      setSelectedCreateStoreId(currentStoreId)
    }

    setIsCreateOpen(true)
    setHasHandledOpenCreateParam(true)
  }, [searchParams, currentStoreId, hasHandledOpenCreateParam])

  const createSupplierMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCreateStoreId) throw new Error('Veuillez sélectionner un store.')
      if (!newName.trim()) throw new Error('Le nom du fournisseur est obligatoire.')

      const { error } = await supabase
        .from('suppliers')
        .insert({
          store_id: selectedCreateStoreId,
          name: newName.trim(),
          phone: newPhone.trim() || null,
          notes: newNotes.trim() || null,
        })

      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      setIsCreateOpen(false)
      setSelectedCreateStoreId(currentStoreId || '')
      setNewName('')
      setNewPhone('')
      setNewNotes('')
      setCreateError('')
    },
    onError: (error: any) => {
      setCreateError(error?.message || 'Erreur lors de la création du fournisseur.')
    },
  })

  const suppliersRows = useMemo(
    () =>
      (suppliersResponse?.data || []).map((supplier: any) => {
        const purchase = purchasesBySupplier?.[supplier.id]
        return {
          ...supplier,
          totalQuantityIn: purchase?.quantity || 0,
          totalAmountIn: purchase?.amount || 0,
        }
      }),
    [suppliersResponse, purchasesBySupplier]
  )

  const totalSuppliers = suppliersResponse?.count || 0
  const totalPages = Math.max(1, Math.ceil(totalSuppliers / PAGE_SIZE))

  return (
    <div className="space-y-6">
      {isCreateOpen ? (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="p-6 border-b flex items-center justify-between shrink-0 bg-card">
              <h3 className="text-lg font-semibold text-foreground">Nouveau fournisseur</h3>
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

                <div>
                  <label className="block text-sm text-foreground mb-1">Nom du fournisseur</label>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="Ex: Fournisseur Casa"
                  />
                </div>

                <div>
                  <label className="block text-sm text-foreground mb-1">Téléphone</label>
                  <input
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="Ex: 06XXXXXXXX"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm text-foreground mb-1">Notes</label>
                  <textarea
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 min-h-[90px]"
                    placeholder="Informations complémentaires..."
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
                onClick={() => createSupplierMutation.mutate()}
                disabled={createSupplierMutation.isPending}
                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white disabled:opacity-50"
              >
                {createSupplierMutation.isPending ? 'Création...' : 'Créer le fournisseur'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="bg-card rounded-xl shadow p-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
          <StoreSelector />

          <div className="flex-1 relative min-w-[220px]">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Rechercher par nom ou téléphone..."
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <button
            onClick={() => {
              setCreateError('')
              setSelectedCreateStoreId(currentStoreId || '')
              setNewName('')
              setNewPhone('')
              setNewNotes('')
              setIsCreateOpen(true)
            }}
            className="inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Ajouter un fournisseur
          </button>
        </div>
      </div>

      <div className="bg-card rounded-xl shadow overflow-hidden">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-muted-foreground mt-2">Chargement des fournisseurs...</p>
            </div>
          ) : suppliersRows.length > 0 ? (
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-secondary">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Fournisseur
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Téléphone
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Quantité achetée (IN)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Montant acheté (IN)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Notes
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-card divide-y divide-border">
                {suppliersRows.map((supplier: any) => (
                  <tr key={supplier.id} className="hover:bg-secondary">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-foreground">{supplier.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Ajouté le {new Date(supplier.created_at).toLocaleDateString('fr-FR')}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground">{supplier.phone || '-'}</td>
                    <td className="px-6 py-4 text-sm font-medium text-foreground">{supplier.totalQuantityIn}</td>
                    <td className="px-6 py-4 text-sm font-medium text-foreground">{formatCurrency(supplier.totalAmountIn)}</td>
                    <td className="px-6 py-4 text-sm text-muted-foreground max-w-[280px]">
                      <div className="truncate" title={supplier.notes || ''}>{supplier.notes || '-'}</div>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium">
                      <button className="text-muted-foreground hover:text-muted-foreground">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center">
              <div className="text-muted-foreground mb-4">Aucun fournisseur trouvé</div>
              <p className="text-muted-foreground">
                {search ? 'Essayez de modifier votre recherche' : 'Ajoutez votre premier fournisseur'}
              </p>
            </div>
          )}
        </div>

        {totalSuppliers > 0 ? (
          <div className="border-t px-6 py-4 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Page {currentPage} / {totalPages} • {totalSuppliers} fournisseurs
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

export default function FournisseursPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div><p className="text-muted-foreground mt-2">Chargement...</p></div>}>
      <FournisseursPageContent />
    </Suspense>
  )
}
