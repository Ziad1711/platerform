'use client'

import { useMemo, useState } from 'react'
import { formatCurrency } from '@/lib/utils'

export type DeliveryCityOption = {
  city_key: string | number
  city_name: string | null
  price?: number | null
}

type DeliveryCityPickerProps = {
  label: string
  placeholder: string
  required?: boolean
  hint?: string
  cities: DeliveryCityOption[]
  query: string
  selectedKey: string
  onQueryChange: (value: string) => void
  onSelect: (city: DeliveryCityOption) => void
}

/** Sélecteur de ville transporteur : recherche libre, sélection obligatoire. */
export default function DeliveryCityPicker({
  label,
  placeholder,
  required,
  hint,
  cities,
  query,
  selectedKey,
  onQueryChange,
  onSelect,
}: DeliveryCityPickerProps) {
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return cities
    return cities.filter((city) => String(city.city_name || '').toLowerCase().includes(term))
  }, [cities, query])

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
        {required ? <span className="font-normal text-muted-foreground"> (obligatoire)</span> : null}
      </label>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder={placeholder}
        />
        {open ? (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-full z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-xl">
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">Aucune ville trouvée</div>
              ) : (
                filtered.map((city) => (
                  <button
                    key={String(city.city_key)}
                    type="button"
                    className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-secondary ${
                      String(selectedKey) === String(city.city_key)
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-foreground'
                    }`}
                    onClick={() => {
                      onSelect(city)
                      setOpen(false)
                    }}
                  >
                    {city.city_name}
                    {city.price != null ? ` — ${formatCurrency(Number(city.price) || 0)}` : ''}
                  </button>
                ))
              )}
            </div>
          </>
        ) : null}
      </div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
