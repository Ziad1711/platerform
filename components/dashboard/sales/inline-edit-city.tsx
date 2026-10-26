'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
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
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
    }
  }, [editing])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setEditing(false)
        setOpen(false)
        setSearch(value)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [value])

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

  if (editing) {
    return (
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
              // Une correspondance (ou la première) est retenue ; sinon le nom
              // saisi est enregistré tel quel et normalisé par la mutation
              // existante (même parcours qu'un choix manuel).
              if (filtered.length > 0) {
                handleSelect(filtered[0])
                return
              }
              const typed = search.trim()
              if (typed && typed !== value) {
                onSave(typed, null)
                setEditing(false)
                setOpen(false)
              }
            }
          }}
          placeholder="Taper une ville puis Entrée..."
          className="w-full border border-primary rounded px-2 py-1 bg-background text-foreground text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {open && filtered.length > 0 && (
          <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
            {filtered.map((city) => (
              <button
                key={city.city_key}
                type="button"
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
            ))}
          </div>
        )}
        {open && filtered.length === 0 && (
          <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg p-3 text-xs text-muted-foreground">
            Aucune ville trouvée
          </div>
        )}
      </div>
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
