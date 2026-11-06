'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

type IntegrationLogoProps = {
  name: string
  logoUrl: string | null
  className?: string
}

function initialsOf(name: string) {
  return name
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

/**
 * Logo d'une intégration du catalogue public.
 * `logo_url` peut être absent ou poindre une favicon distante indisponible :
 * on retombe alors sur les initiales du fournisseur plutôt que sur une image cassée.
 */
export function IntegrationLogo({ name, logoUrl, className }: IntegrationLogoProps) {
  const [failed, setFailed] = useState(false)

  if (!logoUrl || failed) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'flex h-full w-full items-center justify-center text-sm font-bold uppercase tracking-[0.08em] text-jisra-green',
          className
        )}
      >
        {initialsOf(name)}
      </span>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- logos distants hors remotePatterns
    <img
      src={logoUrl}
      alt={name}
      loading="lazy"
      decoding="async"
      className={cn('h-full w-full object-contain p-2', className)}
      onError={() => setFailed(true)}
    />
  )
}
