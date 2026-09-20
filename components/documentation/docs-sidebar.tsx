'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DOC_NAV_GROUPS, DOC_SECTIONS_BY_ID, DOC_SECTION_IDS } from './docs-nav'
import { useActiveDocSection } from './use-active-doc-section'

function SidebarList({ activeId, onNavigate }: { activeId: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Sections de la documentation" className="space-y-7">
      {DOC_NAV_GROUPS.map((group) => (
        <div key={group.title}>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
            {group.title}
          </p>
          <ul className="space-y-1 border-l border-border">
            {group.sections.map((section) => {
              const isActive = section.id === activeId

              return (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    onClick={onNavigate}
                    aria-current={isActive ? 'location' : undefined}
                    className={cn(
                      '-ml-px block rounded-r-lg border-l-2 py-2 pl-4 pr-2 text-[15px] leading-6 transition-colors',
                      isActive
                        ? 'border-[#1fa971] bg-[#1fa971]/10 font-semibold text-[#0f8a5c] dark:text-[#3fd39a]'
                        : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    )}
                  >
                    {section.label}
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

/**
 * Navigation verticale sticky à gauche de l'écran (>= 768px).
 * La section visible est mise en évidence automatiquement pendant le défilement.
 */
export function DocsSidebar() {
  const activeId = useActiveDocSection(DOC_SECTION_IDS)

  return (
    <aside className="hidden md:block">
      <div className="sticky top-0 max-h-[calc(100vh-56px)] overflow-y-auto py-8 pr-2">
        <p className="mb-5 text-sm font-semibold uppercase tracking-[0.18em] text-foreground">
          Sur cette page
        </p>
        <SidebarList activeId={activeId} />
      </div>
    </aside>
  )
}

/** Version repliable de la navigation pour mobile (< 768px). */
export function DocsMobileNav() {
  const [open, setOpen] = useState(false)
  const activeId = useActiveDocSection(DOC_SECTION_IDS)
  const activeLabel = DOC_SECTIONS_BY_ID[activeId]?.label || "Vue d'ensemble"

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left text-sm font-semibold text-foreground"
      >
        <span className="truncate">
          <span className="text-muted-foreground">Sur cette page : </span>
          {activeLabel}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div className="mt-3 rounded-xl border border-border bg-card p-4">
          <SidebarList activeId={activeId} onNavigate={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  )
}

