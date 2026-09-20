'use client'

import { useEffect, useState } from 'react'

/**
 * Renvoie l'identifiant de la section actuellement visible.
 * `ids` doit être une constante stable (voir DOC_SECTION_IDS).
 */
export function useActiveDocSection(ids: string[], fallback?: string): string {
  const [activeId, setActiveId] = useState<string>(fallback || ids[0] || '')

  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return

    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => Boolean(element))

    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)

        if (visible.length > 0) {
          setActiveId(visible[0].target.id)
        }
      },
      { rootMargin: '-96px 0px -65% 0px', threshold: 0 }
    )

    elements.forEach((element) => observer.observe(element))

    return () => observer.disconnect()
  }, [ids])

  return activeId
}
