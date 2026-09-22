'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { buildUniqueCategorySlug } from '@/lib/products/slug'

const NEW_CATEGORY_VALUE = '__new_category__'

export type ProductCategory = {
  id: string
  name: string
  slug: string
  sort_order?: number | null
}

/** Sélecteur de catégorie produit avec création rapide, scopé au store courant. */
export function CategorySelect({
  categories,
  value,
  onChange,
  storeId,
  onCreated,
  className,
}: {
  categories: ProductCategory[]
  value: string
  onChange: (categoryId: string) => void
  storeId: string | null
  onCreated?: () => void | Promise<void>
  className?: string
}) {
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const supabase = createClient()

  const handleChange = (next: string) => {
    if (next === NEW_CATEGORY_VALUE) {
      setIsCreating(true)
      return
    }
    setIsCreating(false)
    onChange(next)
  }

  const createCategory = async () => {
    const name = newName.trim()
    if (!name) {
      toast.error('Le nom de la catégorie est obligatoire.')
      return
    }

    if (!storeId) {
      toast.error('Aucun store sélectionné.')
      return
    }

    setIsSaving(true)

    try {
      const slug = await buildUniqueCategorySlug({ supabase, storeId, base: name })

      const { data, error } = await supabase
        .from('product_categories')
        .insert({ store_id: storeId, name, slug, sort_order: (categories || []).length + 1 })
        .select('id')
        .single()

      if (error) throw error

      await onCreated?.()
      onChange(String(data.id))
      setNewName('')
      setIsCreating(false)
      toast('Catégorie créée')
    } catch (error: any) {
      toast.error(error?.message || 'Impossible de créer la catégorie.')
    } finally {
      setIsSaving(false)
    }
  }

  if (isCreating) {
    return (
      <div className={className}>
        <div className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nom de la nouvelle catégorie"
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void createCategory()}
            disabled={isSaving}
            className="whitespace-nowrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {isSaving ? '...' : 'Créer'}
          </button>
          <button
            type="button"
            onClick={() => {
              setIsCreating(false)
              setNewName('')
            }}
            className="whitespace-nowrap rounded-lg border px-3 py-2 text-sm text-foreground"
          >
            Annuler
          </button>
        </div>
      </div>
    )
  }

  return (
    <select
      value={value || ''}
      onChange={(e) => handleChange(e.target.value)}
      className={className || 'w-full border rounded-lg px-3 py-2 text-sm'}
    >
      <option value="">Aucune catégorie</option>
      {(categories || []).map((category) => (
        <option key={category.id} value={category.id}>
          {category.name}
        </option>
      ))}
      <option value={NEW_CATEGORY_VALUE}>＋ Nouvelle catégorie…</option>
    </select>
  )
}
