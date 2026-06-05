'use client'

import { useState, useRef, useEffect } from 'react'
import { MapPin } from 'lucide-react'

interface InlineEditAddressModalProps {
  value: string
  onSave: (value: string) => void
  className?: string
}

export default function InlineEditAddressModal({
  value,
  onSave,
  className = '',
}: InlineEditAddressModalProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setDraft(value)
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [open, value])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const handleSave = () => {
    const trimmed = draft.trim()
    if (trimmed !== value) {
      onSave(trimmed)
    }
    setOpen(false)
  }

  const handleCancel = () => {
    setDraft(value)
    setOpen(false)
  }

  return (
    <>
      <div
        onDoubleClick={() => setOpen(true)}
        className={`cursor-pointer hover:bg-secondary/50 rounded px-1 -mx-1 ${className}`}
        title="Double-clic pour modifier l'adresse"
      >
        {value || <span className="text-muted-foreground italic">Adresse</span>}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={handleCancel} />
          <div
            ref={containerRef}
            className="relative z-10 w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl flex flex-col max-h-[80vh]"
          >
            <div className="flex items-center justify-between px-6 pt-6 pb-3">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-primary" />
                <h3 className="text-lg font-semibold text-foreground">Modifier l'adresse</h3>
              </div>
              <button
                type="button"
                onClick={handleCancel}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Fermer
              </button>
            </div>

            <div className="px-6 pb-3 flex-1 space-y-4">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') handleCancel()
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSave()
                }}
                placeholder="Adresse complète..."
                rows={4}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-y min-h-[100px]"
              />
              <p className="text-xs text-muted-foreground">
                Ctrl+Enter pour valider
              </p>
            </div>

            <div className="flex items-center justify-between border-t border-border px-6 pt-4 pb-6">
              <div />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-secondary"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
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
