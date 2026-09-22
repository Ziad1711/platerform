'use client'

import { useRef } from 'react'
import { ArrowLeft, ArrowRight, ImagePlus, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { validateProductImageFile } from '@/lib/products/product-images'

export type GalleryItem = {
  /** Identifiant `product_images.id` pour une image déjà enregistrée. */
  id?: string | null
  /** Valeur stockée : chemin Storage (fichier Jisra) ou URL externe. */
  url: string
  /** Fichier local en attente d'upload. */
  file?: File | null
  /** Aperçu local du fichier en attente. */
  previewUrl?: string
  alt_text: string
  is_primary: boolean
}

export function galleryItemSrc(item: GalleryItem, resolveUrl: (raw: string) => string | null): string | null {
  if (item.previewUrl) return item.previewUrl
  return resolveUrl(item.url)
}

export function ProductGalleryEditor({
  items,
  onChange,
  resolveUrl,
  label,
  helpText,
  compact = false,
}: {
  items: GalleryItem[]
  onChange: (items: GalleryItem[]) => void
  resolveUrl: (raw: string) => string | null
  label: string
  helpText?: string
  compact?: boolean
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const gallery = items || []

  const update = (next: GalleryItem[]) => {
    // L'ordre visuel détermine `sort_order` ; une seule image principale est conservée.
    const withPrimary =
      next.length > 0 && !next.some((item) => item.is_primary)
        ? next.map((item, index) => (index === 0 ? { ...item, is_primary: true } : item))
        : next

    onChange(withPrimary)
  }

  const appendFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return

    const additions: GalleryItem[] = []

    for (const file of Array.from(files)) {
      try {
        validateProductImageFile(file)
      } catch (error: any) {
        toast.error(error?.message || 'Image invalide.')
        continue
      }

      additions.push({
        id: null,
        url: '',
        file,
        previewUrl: URL.createObjectURL(file),
        alt_text: '',
        is_primary: false,
      })
    }

    if (additions.length === 0) return
    update([...gallery, ...additions])

    if (inputRef.current) inputRef.current.value = ''
  }

  const removeAt = (index: number) => {
    const target = gallery[index]
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
    update(gallery.filter((_, i) => i !== index))
  }

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= gallery.length) return

    const next = [...gallery]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    update(next)
  }

  const setPrimary = (index: number) => {
    update(gallery.map((item, i) => ({ ...item, is_primary: i === index })))
  }


  const setAlt = (index: number, value: string) => {
    update(gallery.map((item, i) => (i === index ? { ...item, alt_text: value } : item)))
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="block text-sm font-medium text-foreground">{label}</label>
        <span className="text-xs text-muted-foreground">{gallery.length} photo(s)</span>
      </div>

      <div className={compact ? 'flex flex-wrap gap-2' : 'grid grid-cols-2 gap-3 sm:grid-cols-3'}>
        {gallery.map((item, index) => {
          const src = galleryItemSrc(item, resolveUrl)

          return (
            <div key={item.id || `new-${index}`} className="space-y-2 rounded-lg border border-border bg-card p-2">
              <div className="relative">
                <div className="h-24 w-full overflow-hidden rounded-md bg-secondary">
                  {src ? (
                    <img src={src} alt={item.alt_text || 'Image produit'} className="h-24 w-full object-cover" />
                  ) : (
                    <div className="flex h-24 w-full items-center justify-center text-xs text-muted-foreground">
                      Image à envoyer
                    </div>
                  )}
                </div>

                {item.is_primary ? (
                  <span className="absolute left-1 top-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                    Principale
                  </span>
                ) : null}
              </div>

              <input
                value={item.alt_text}
                onChange={(e) => setAlt(index, e.target.value)}
                placeholder="Texte alternatif"
                className="w-full rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground"
              />

              <div className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  onClick={() => setPrimary(index)}
                  disabled={item.is_primary}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground disabled:opacity-40"
                  title="Définir comme image principale"
                >
                  <Star className="h-3 w-3" />
                  Principale
                </button>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    className="rounded-md border border-border p-1 text-foreground disabled:opacity-40"
                    title="Déplacer avant"
                  >
                    <ArrowLeft className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === gallery.length - 1}
                    className="rounded-md border border-border p-1 text-foreground disabled:opacity-40"
                    title="Déplacer après"
                  >
                    <ArrowRight className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeAt(index)}
                    className="rounded-md border border-border p-1 text-red-600"
                    title="Supprimer"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          )
        })}

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex h-full min-h-[120px] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/20 px-3 py-4 text-xs text-muted-foreground hover:bg-muted/40"
        >
          <ImagePlus className="h-5 w-5" />
          Ajouter des photos
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => appendFiles(e.target.files)}
      />

      <p className="text-xs text-muted-foreground">
        {helpText || 'JPEG, PNG ou WebP — 5 Mo maximum par image. Utilisez « Principale » pour choisir l’image affichée en premier.'}
      </p>
    </div>
  )
}
