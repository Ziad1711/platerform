'use client'

import { useState, useRef, useEffect, useMemo } from 'react'

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
            if (e.key === 'Enter' && filtered.length === 1) {
              handleSelect(filtered[0])
            }
          }}
          placeholder="Taper pour chercher une ville..."
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
      onDoubleClick={() => {
        setSearch('')
        setEditing(true)
      }}
      className={`cursor-pointer hover:bg-secondary/50 rounded px-1 -mx-1 ${className}`}
      title="Double-clic pour changer la ville"
    >
      {value || <span className="text-muted-foreground italic">—</span>}
    </div>
  )
}
