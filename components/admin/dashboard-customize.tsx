'use client'

import { useCallback, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { DASHBOARD_WIDGETS, type DashboardLayout } from '@/lib/admin/dashboard-layout'
import { useDismiss } from '@/lib/admin/use-dismiss'

/** Panneau compact : visibilité et ordre des widgets (préférences locales). */
export function CustomizeMenu({ layout }: { layout: DashboardLayout }) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement | null>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, container)
  const visibleCount = layout.order.filter((id) => !layout.hidden.includes(id)).length

  return <div ref={container} className="relative">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="dashboard-customize-menu"
      className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-4 text-sm hover:border-jisra-green/40 sm:w-52">
      <span className="flex items-center gap-2"><SlidersHorizontal size={16} aria-hidden /> Personnaliser</span>
      <ChevronDown size={16} aria-hidden className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
    </button>
    {open && <div id="dashboard-customize-menu" className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-white/15 bg-jisra-ink p-3 shadow-2xl">
      <p className="px-1 pb-1 text-xs uppercase tracking-wider text-jisra-cream/55">Widgets affichés</p>
      <p className="px-1 pb-2 text-xs leading-5 text-jisra-cream/55">Ordre et visibilité conservés dans ce navigateur uniquement.</p>
      <ul className="space-y-1">
        {layout.order.map((id, index) => {
          const widget = DASHBOARD_WIDGETS.find((entry) => entry.id === id)!
          const visible = !layout.hidden.includes(id)
          return <li key={id} className="flex items-center gap-2 rounded-xl px-1 py-1 hover:bg-white/5">
            <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-sm">
              <input type="checkbox" checked={visible} onChange={() => layout.toggle(id)} className="h-4 w-4 accent-jisra-green" />
              <span className={`truncate ${visible ? '' : 'text-jisra-cream/45'}`}>{widget.label}</span>
            </label>
            <button type="button" onClick={() => layout.move(id, -1)} disabled={index === 0} aria-label={`Monter ${widget.label}`}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 disabled:opacity-30"><ArrowUp size={15} aria-hidden /></button>
            <button type="button" onClick={() => layout.move(id, 1)} disabled={index === layout.order.length - 1} aria-label={`Descendre ${widget.label}`}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 disabled:opacity-30"><ArrowDown size={15} aria-hidden /></button>
          </li>
        })}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/10 pt-3">
        <span className="text-xs text-jisra-cream/55">{visibleCount} / {layout.order.length} affiché(s)</span>
        <button type="button" onClick={layout.reset}
          className="flex min-h-11 items-center gap-2 rounded-xl border border-white/15 px-3 text-xs hover:border-jisra-green/40"><RotateCcw size={14} aria-hidden /> Réinitialiser</button>
      </div>
    </div>}
  </div>
}
