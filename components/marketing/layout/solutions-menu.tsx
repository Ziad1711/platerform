'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { MarketingSolution } from '@/lib/marketing/site'
import { SOLUTION_ICONS } from '@/components/marketing/layout/solution-icons'

/** Menu déroulant « Solutions » : survol, clic, clavier, fermeture Échap/route/extérieur. */
export function SolutionsMenu({ items }: { items: MarketingSolution[] }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const container = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  const close = useCallback(() => setOpen(false), [])

  // Fermeture lors d'un changement de page (le layout reste monté entre deux routes).
  // Ajustement d'état pendant le rendu : pas d'effet ni de rendu en cascade.
  const [lastPathname, setLastPathname] = useState(pathname)
  if (lastPathname !== pathname) {
    setLastPathname(pathname)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (container.current && !container.current.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      close()
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  function links(): HTMLAnchorElement[] {
    return Array.from(panel.current?.querySelectorAll<HTMLAnchorElement>('a[data-solution-link]') ?? [])
  }

  function focusLink(index: number) {
    const list = links()
    if (list.length === 0) return
    const bounded = (index + list.length) % list.length
    list[bounded].focus()
  }

  function onPanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const list = links()
    const current = list.indexOf(document.activeElement as HTMLAnchorElement)
    if (event.key === 'ArrowDown') { event.preventDefault(); focusLink(current + 1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); focusLink(current - 1) }
    else if (event.key === 'Home') { event.preventDefault(); focusLink(0) }
    else if (event.key === 'End') { event.preventDefault(); focusLink(list.length - 1) }
  }

  return <div ref={container} className="relative"
    onPointerEnter={(event) => { if (event.pointerType === 'mouse') setOpen(true) }}
    onPointerLeave={(event) => { if (event.pointerType === 'mouse') setOpen(false) }}>
    <button ref={trigger} type="button" aria-expanded={open} aria-controls="solutions-menu" aria-haspopup="true"
      onClick={() => setOpen((value) => !value)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setOpen(true)
          requestAnimationFrame(() => focusLink(0))
        }
      }}
      className={`group relative flex items-center gap-1 rounded-xl px-2.5 py-2.5 text-sm font-medium transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jisra-green/60 ${open ? 'text-jisra-cream' : 'text-jisra-cream/68 hover:text-jisra-cream'}`}>
      <span>Solutions</span>
      <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      <span aria-hidden className={`absolute inset-x-4 bottom-1 h-px origin-left bg-jisra-green transition-transform duration-300 ${open ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'}`} />
    </button>

    {open ? <div ref={panel} id="solutions-menu" aria-label="Solutions" onKeyDown={onPanelKeyDown}
      className="absolute left-1/2 top-full z-[75] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 pt-2">
      <div className="rounded-[22px] border border-white/10 bg-jisra-ink-light p-2 shadow-[0_28px_90px_rgba(0,0,0,0.45)]">
        <ul className="grid gap-1">
          {items.map((item) => {
            const Icon = SOLUTION_ICONS[item.icon]
            return <li key={item.href}>
              <Link href={item.href} data-solution-link onClick={close}
                className="flex items-start gap-3 rounded-2xl px-3 py-3 transition hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jisra-green/60">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-jisra-green/10">
                  <Icon aria-hidden className="h-4 w-4 text-jisra-green" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-jisra-cream">{item.title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-jisra-cream/60">{item.description}</span>
                </span>
              </Link>
            </li>
          })}
        </ul>
      </div>
    </div> : null}
  </div>
}
