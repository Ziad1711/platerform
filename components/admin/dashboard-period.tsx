'use client'

import { useCallback, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { PERIOD_PRESETS, periodLabel, presetRange, validateRange, type PeriodPreset, type PeriodRange } from '@/lib/admin/dashboard-range'
import { useDismiss } from '@/lib/admin/use-dismiss'

/** Sélecteur de période compact (prédéfinis + intervalle personnalisé). */
export function PeriodMenu({ preset, range, onChange }: {
  preset: PeriodPreset
  range: PeriodRange
  onChange: (preset: PeriodPreset, range: PeriodRange) => void
}) {
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(range.from)
  const [draftUntil, setDraftUntil] = useState(range.until)
  const [error, setError] = useState<string | null>(null)
  const container = useRef<HTMLDivElement | null>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, container)

  function toggleMenu() {
    if (!open) {
      setDraftFrom(range.from)
      setDraftUntil(range.until)
      setError(null)
    }
    setOpen(!open)
  }

  function choose(value: PeriodPreset, days: number) {
    onChange(value, presetRange(days))
    setOpen(false)
  }

  function applyCustom() {
    const problem = validateRange(draftFrom, draftUntil)
    setError(problem)
    if (problem) return
    onChange('custom', { from: draftFrom, until: draftUntil })
    setOpen(false)
  }

  return <div ref={container} className="relative">
    <button type="button" onClick={toggleMenu} aria-expanded={open} aria-controls="dashboard-period-menu"
      className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-4 text-sm hover:border-jisra-green/40 sm:w-52">
      <span className="truncate">{periodLabel(preset, range)}</span>
      <ChevronDown size={16} aria-hidden className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
    </button>
    {open && <div id="dashboard-period-menu" className="absolute right-0 z-30 mt-2 w-[min(19rem,calc(100vw-2rem))] rounded-2xl border border-white/15 bg-jisra-ink p-3 shadow-2xl">
      <p className="px-1 pb-2 text-xs uppercase tracking-wider text-jisra-cream/55">Période</p>
      <div role="group" aria-label="Périodes prédéfinies" className="grid gap-1">
        {PERIOD_PRESETS.map((item) => <button key={item.value} type="button" aria-pressed={preset === item.value}
          onClick={() => choose(item.value, item.days)}
          className={`flex min-h-11 items-center rounded-xl px-3 text-left text-sm ${preset === item.value ? 'bg-jisra-green/15 text-jisra-green-light' : 'text-jisra-cream/80 hover:bg-white/5'}`}>{item.label}</button>)}
      </div>
      <div className="mt-2 border-t border-white/10 pt-3">
        <p className="px-1 pb-2 text-xs uppercase tracking-wider text-jisra-cream/55">Période personnalisée</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-xs"><span className="text-jisra-cream/65">Du (inclus)</span>
            <input type="date" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)}
              className="min-h-11 w-full rounded-xl border border-white/20 bg-jisra-ink px-2 text-sm" /></label>
          <label className="space-y-1 text-xs"><span className="text-jisra-cream/65">Au (exclu)</span>
            <input type="date" value={draftUntil} onChange={(event) => setDraftUntil(event.target.value)}
              className="min-h-11 w-full rounded-xl border border-white/20 bg-jisra-ink px-2 text-sm" /></label>
        </div>
        {error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
        <button type="button" onClick={applyCustom}
          className="mt-3 min-h-11 w-full rounded-xl bg-jisra-green px-3 text-sm font-medium text-jisra-ink hover:bg-jisra-green-light">Appliquer la période</button>
      </div>
    </div>}
  </div>
}
