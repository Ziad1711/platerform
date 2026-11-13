'use client'

import { useEffect } from 'react'

/** Ferme un panneau au clic/toucher extérieur ou sur Échap. */
export function useDismiss(
  open: boolean,
  close: () => void,
  ref: React.RefObject<HTMLDivElement | null>
) {
  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('touchstart', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('touchstart', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close, ref])
}
