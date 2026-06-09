'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Store, Trash2, Pencil, Plus, Building2, Loader2, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { usePermissions } from '@/lib/auth/use-permissions'
import { useStore } from '@/lib/store-context'

interface StoreItem {
  id: string
  name: string
  logo_url: string | null
  currency: string
  country: string | null
  role: string
}

async function toJson(res: Response) {
  const payload = await res.json().catch(() => null)
  if (!res.ok) throw new Error(payload?.error || 'REQUEST_FAILED')
  return payload
}

export default function StoresSection() {
  const queryClient = useQueryClient()
  const supabase = createClient()
  const { userId } = useStore()
  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit] = useState<StoreItem | null>(null)
  const [showDelete, setShowDelete] = useState<StoreItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', currency: 'MAD', country: '' })
  const [editForm, setEditForm] = useState({ name: '', currency: 'MAD', country: '' })


  const currentStoreId = typeof window !== 'undefined'
    ? localStorage.getItem('current-store-id')
    : null

  const { can } = usePermissions(currentStoreId)

  const { data: storesPayload, isLoading } = useQuery({
    queryKey: ['my-stores'],
    queryFn: async () => toJson(await fetch('/api/stores/list')),
  })

  const stores: StoreItem[] = storesPayload?.stores || []

  async function handleCreate() {
    setSaving(true)
    try {
      await toJson(await fetch('/api/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      }))
      await queryClient.invalidateQueries({ queryKey: ['my-stores'] })
      await queryClient.invalidateQueries({ queryKey: ['accessible-stores'] })
      setShowCreate(false)
      setCreateForm({ name: '', currency: 'MAD', country: '' })
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erreur')
    } finally { setSaving(false) }
  }

  async function handleEdit() {
    if (!showEdit) return
    setSaving(true)
    try {
      await toJson(await fetch(`/api/stores/${showEdit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      }))
      await queryClient.invalidateQueries({ queryKey: ['my-stores'] })
      await queryClient.invalidateQueries({ queryKey: ['accessible-stores'] })
      setShowEdit(null)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erreur')
    } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!showDelete) return
    setSaving(true)
    try {
      await toJson(await fetch(`/api/stores/${showDelete.id}`, { method: 'DELETE' }))
      await queryClient.invalidateQueries({ queryKey: ['my-stores'] })
      await queryClient.invalidateQueries({ queryKey: ['accessible-stores'] })
      setShowDelete(null)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erreur')
    } finally { setSaving(false) }
  }

  return (
    <section id="stores" className="rounded-2xl border bg-card p-6 scroll-mt-32">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Building2 className="h-5 w-5"/>Mes stores</h2>
        {can('stores.create') && (
          <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            <Plus className="h-4 w-4"/>Nouveau store
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>Chargement...</div>
      ) : stores.length === 0 ? (
        <div className="mt-4 text-sm text-muted-foreground">Aucun store.</div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {stores.map((store) => (
            <div key={store.id} className="rounded-xl border p-4 flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                {store.logo_url ? <img src={store.logo_url} alt="" className="h-6 w-6 object-contain"/> : <Store className="h-5 w-5 text-primary"/>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{store.name}</div>
                <div className="text-xs text-muted-foreground">{store.currency} {store.country ? `· ${store.country}` : ''}</div>
                <div className="mt-1 inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium">{store.role}</div>
              </div>
              <div className="flex items-center gap-1">
                {can('stores.update') && store.role !== 'viewer' && store.role !== 'confirmation' && store.role !== 'delivery' && store.role !== 'stock_manager' && store.role !== 'accountant' && store.role !== 'marketer' && (
                  <button onClick={() => { setShowEdit(store); setEditForm({ name: store.name, currency: store.currency, country: store.country || '' }) }} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground">
                    <Pencil className="h-4 w-4"/>
                  </button>
                )}
                {store.role === 'owner' && (
                  <button onClick={() => setShowDelete(store)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-600">
                    <Trash2 className="h-4 w-4"/>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-xl">
            <h3 className="text-lg font-semibold">Créer un store</h3>
            <div className="mt-4 space-y-3">
              <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground ml-1">Nom</label><input value={createForm.name} onChange={e => setCreateForm({...createForm, name: e.target.value})} className="w-full rounded-xl border bg-background px-4 py-3 text-sm"/></div>
              <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground ml-1">Devise</label><select value={createForm.currency} onChange={e => setCreateForm({...createForm, currency: e.target.value})} className="w-full rounded-xl border bg-background px-4 py-3 text-sm"><option>MAD</option><option>USD</option><option>EUR</option></select></div>
              <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground ml-1">Pays</label><input value={createForm.country} onChange={e => setCreateForm({...createForm, country: e.target.value})} className="w-full rounded-xl border bg-background px-4 py-3 text-sm"/></div>
            </div>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button onClick={() => setShowCreate(false)} className="rounded-xl border px-4 py-2 text-sm font-medium">Annuler</button>
              <button onClick={handleCreate} disabled={saving || !createForm.name.trim()} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">{saving ? 'Création...' : 'Créer'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-xl">
            <h3 className="text-lg font-semibold">Modifier le store</h3>
            <div className="mt-4 space-y-3">
              <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground ml-1">Nom</label><input value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} className="w-full rounded-xl border bg-background px-4 py-3 text-sm"/></div>
              <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground ml-1">Devise</label><select value={editForm.currency} onChange={e => setEditForm({...editForm, currency: e.target.value})} className="w-full rounded-xl border bg-background px-4 py-3 text-sm"><option>MAD</option><option>USD</option><option>EUR</option></select></div>
              <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground ml-1">Pays</label><input value={editForm.country} onChange={e => setEditForm({...editForm, country: e.target.value})} className="w-full rounded-xl border bg-background px-4 py-3 text-sm"/></div>
            </div>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button onClick={() => setShowEdit(null)} className="rounded-xl border px-4 py-2 text-sm font-medium">Annuler</button>
              <button onClick={handleEdit} disabled={saving || !editForm.name.trim()} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-xl">
            <div className="flex items-center gap-3 text-red-600"><AlertTriangle className="h-6 w-6"/><h3 className="text-lg font-semibold">Supprimer le store</h3></div>
            <p className="mt-2 text-sm text-muted-foreground">Cette action est irréversible. Toutes les données (commandes, produits, intégrations...) seront supprimées.</p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button onClick={() => setShowDelete(null)} className="rounded-xl border px-4 py-2 text-sm font-medium">Annuler</button>
              <button onClick={handleDelete} disabled={saving} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white">{saving ? 'Suppression...' : 'Supprimer définitivement'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
