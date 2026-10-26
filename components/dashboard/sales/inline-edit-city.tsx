'use client'

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Pencil } from 'lucide-react'

interface CityOption {
  city_key: number
  city_name: string
  cost_delivery?: number
}

interface InlineEditCityProps {
  value: string
  cities: CityOption[]
  onSave: (cityName: string, cityKey: number | null) => void
  className?: string
}

export default function InlineEditCity({
  value,
  cities,
  onSave,
  className = '',
}: InlineEditCityProps) {
  const [editing, setEditing] = useState(false)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
    }
  }, [editing])

  // Le tableau Sales vit dans un conteneur `overflow-x-auto overflow-y-hidden` :
  // un menu `absolute` y est clippé (surtout sur les dernières lignes). Le menu
  // est donc rendu dans `document.body` avec une position `fixed` recalculée.
  const updateMenuPosition = useCallback(() => {
    const input = inputRef.current
    if (!input) return
    const rect = input.getBoundingClientRect()
    const margin = 4
    const spaceBelow = window.innerHeight - rect.bottom - margin
    const spaceAbove = rect.top - margin
    const width = Math.max(rect.width, 220)
    const openUp = spaceBelow < 200 && spaceAbove > spaceBelow
    const maxHeight = Math.min(288, Math.max(120, (openUp ? spaceAbove : spaceBelow) - 8))
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    const top = openUp
      ? Math.max(8, rect.top - margin - maxHeight)
      : Math.min(rect.bottom + margin, window.innerHeight - 8)
    setMenuPos({ top, left, width, maxHeight })
  }, [])

  useEffect(() => {
    if (!open) return
    updateMenuPosition()
    const onScrollOrResize = () => updateMenuPosition()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open, updateMenuPosition])

  // (Le gestionnaire de clic extérieur est défini plus bas, après `commitCurrent`.)

  const filtered = useMemo(
    () =>
      cities.filter((c) =>
        c.city_name.toLowerCase().includes(search.toLowerCase())
      ),
    [cities, search]
  )

  const handleSelect = (city: CityOption) => {
    onSave(city.city_name, city.city_key)
    setSearch(city.city_name)
    setEditing(false)
    setOpen(false)
  }

  // Libellé comparable pour retrouver une correspondance exacte saisie à la main.
  const cityLabel = (raw: string) =>
    raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')

  /**
   * Valide la saisie courante :
   * - correspondance exacte du catalogue → nom + clé du transporteur ;
   * - sinon première correspondance partielle (comportement historique) ;
   * - sinon le **nom saisi est conservé tel quel**, sans clé inventée : une
   *   ville absente des alias doit quand même pouvoir être enregistrée.
   */
  const commitCurrent = useCallback(() => {
    const typed = search.trim()
    if (!typed || typed === value) return
    if (filtered.length > 0) {
      const exact = filtered.find((city) => cityLabel(city.city_name) === cityLabel(typed))
      const target = exact || filtered[0]
      onSave(target.city_name, target.city_key)
      return
    }
    onSave(typed, null)
  }, [search, value, filtered, onSave])

  // Clic extérieur = validation de la saisie (nom libre inclus), sauf Échap.
  // Le menu étant un portail hors du conteneur, il fait partie de l'éditeur et
  // ne doit jamais provoquer sa fermeture avant sélection.
  useEffect(() => {
    if (!editing) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (containerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      commitCurrent()
      setEditing(false)
      setOpen(false)
      setSearch(value)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [editing, value, commitCurrent])

  if (editing) {
    return (
      <>
      <div ref={containerRef} className="relative">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setEditing(false)
              setSearch(value)
              setOpen(false)
            }
            if (e.key === 'Enter') {
              // Sélection exacte, sinon première correspondance, sinon le nom
              // saisi est conservé (jamais de clé inventée).
              commitCurrent()
              setEditing(false)
              setOpen(false)
            }
          }}
          placeholder="Taper une ville puis Entrée..."
          className="w-full border border-primary rounded px-2 py-1 bg-background text-foreground text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
        {open && menuPos && typeof document !== 'undefined'
          ? createPortal(
              <div
                ref={menuRef}
                role="listbox"
                style={{
                  position: 'fixed',
                  top: menuPos.top,
                  left: menuPos.left,
                  width: menuPos.width,
                  maxHeight: menuPos.maxHeight,
                  zIndex: 1000,
                }}
                className="overflow-y-auto rounded-lg border border-border bg-popover shadow-lg"
              >
                {filtered.length > 0 ? (
                  filtered.map((city) => (
                    <button
                      key={city.city_key}
                      type="button"
                      role="option"
                      aria-selected={city.city_name === value}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        handleSelect(city)
                      }}
                      className={`w-full text-left px-3 py-2 text-xs sm:text-sm hover:bg-secondary transition-colors ${
                        city.city_name === value ? 'bg-secondary font-medium' : ''
                      }`}
                    >
                      <span>{city.city_name}</span>
                      {city.cost_delivery != null && (
                        <span className="text-muted-foreground ml-2">
                          — {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'MAD' }).format(city.cost_delivery)}
                        </span>
                      )}
                    </button>
                  ))
                ) : (
                  <div className="p-3 text-xs text-muted-foreground">
                    Aucune ville trouvée. Saisissez un nom puis appuyez sur Entrée.
                  </div>
                )}
              </div>,
              document.body,
            )
          : null}
      </>
    )
  }

  return (
    <div
      onClick={() => {
        setSearch('')
        setEditing(true)
      }}
      onDoubleClick={() => {
        setSearch('')
        setEditing(true)
      }}
      className={`group inline-flex items-center gap-1 cursor-text hover:bg-secondary/50 rounded px-1 -mx-1 ${className}`}
      title="Cliquer pour changer la ville"
    >
      <span>{value || <span className="text-muted-foreground italic">—</span>}</span>
      <span
        role="button"
        onClick={(e) => {
          e.stopPropagation()
          setSearch('')
          setEditing(true)
        }}
        className="shrink-0 cursor-pointer p-0.5 text-muted-foreground/60 hover:text-foreground transition-colors"
        title="Modifier"
      >
        <Pencil className="h-3.5 w-3.5" />
      </span>
    </div>
  )
}
