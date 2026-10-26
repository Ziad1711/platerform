'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Montage différé d'une section du Dashboard.
 *
 * Objectif : ne pas disputer le réseau ni le pool aux cartes KPI principales.
 * Les cartes KPI sont montées dans le premier commit ; les sections situées
 * plus bas ne montent leurs composants (et donc leurs lectures React Query)
 * qu'à l'approche du viewport.
 *
 * Garanties :
 * - une section déjà visible (ou proche) est montée immédiatement, sans écran
 *   vide ni décalage ;
 * - le montage est définitif : les filtres, le changement de boutique et les
 *   invalidations continuent de fonctionner normalement ensuite ;
 * - en l'absence d'`IntersectionObserver`, la section est montée directement
 *   (aucun contenu perdu).
 */
interface DeferredSectionProps {
  children: ReactNode
  /** Libellé lu par les lecteurs d'écran pendant l'attente. */
  label: string
  /** Marge d'anticipation sous le viewport, en pixels. */
  rootMarginPx?: number
  /** Hauteur réservée par le squelette, en pixels. */
  minHeight?: number
  className?: string
}

export default function DeferredSection({
  children,
  label,
  rootMarginPx = 200,
  minHeight = 320,
  className,
}: DeferredSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (mounted) return
    const node = containerRef.current
    if (!node) return

    // Ceinture de sécurité : pas d'API d'observation → montage direct.
    if (typeof IntersectionObserver === 'undefined') {
      setMounted(true)
      return
    }

    // Déjà dans le viewport : montage immédiat (aucun écran vide sur une
    // section réellement visible). Cet effet s'exécute après le montage des
    // cartes KPI, qui gardent donc la priorité réseau.
    const viewport = window.innerHeight || document.documentElement.clientHeight
    if (node.getBoundingClientRect().top <= viewport) {
      setMounted(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setMounted(true)
        observer.disconnect()
      },
      { rootMargin: `0px 0px ${rootMarginPx}px 0px` },
    )
    observer.observe(node)

    return () => observer.disconnect()
  }, [mounted, rootMarginPx])

  return (
    <div
      ref={containerRef}
      className={className}
      data-deferred-section={mounted ? 'mounted' : 'pending'}
    >
      {mounted ? (
        children
      ) : (
        <div
          className="rounded-xl border border-border bg-card"
          style={{ minHeight }}
          role="status"
          aria-live="polite"
        >
          <span className="sr-only">{label}</span>
        </div>
      )}
    </div>
  )
}
