'use client'

import { cn } from '@/lib/utils'

export type PublicationStatus = 'draft' | 'active' | 'archived'

export const PUBLICATION_STATUS_OPTIONS: Array<{
  value: PublicationStatus
  label: string
  hint: string
}> = [
  {
    value: 'active',
    label: 'Publié',
    hint: "Visible sur le site connecté via l'API catalogue.",
  },
  {
    value: 'draft',
    label: 'Brouillon',
    hint: "Non exposé par l'API (produit en préparation).",
  },
  {
    value: 'archived',
    label: 'Archivé',
    hint: "Retiré de la vente, conservé pour l'historique des commandes.",
  },
]

export function normalizePublicationStatus(value: unknown): PublicationStatus {
  const raw = String(value || '').trim()
  if (raw === 'draft' || raw === 'archived') return raw
  return 'active'
}

export function getPublicationStatusLabel(value: unknown): string {
  const normalized = normalizePublicationStatus(value)
  return PUBLICATION_STATUS_OPTIONS.find((option) => option.value === normalized)?.label || 'Publié'
}

const BADGE_CLASSES: Record<PublicationStatus, string> = {
  active: 'border-[#1fa971]/20 bg-[#1fa971]/10 text-[#1fa971]',
  draft: 'border-amber-500/20 bg-amber-500/10 text-amber-600',
  archived: 'border-border bg-muted text-muted-foreground',
}

export function PublicationStatusBadge({
  status,
  className,
}: {
  status: unknown
  className?: string
}) {
  const normalized = normalizePublicationStatus(status)

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        BADGE_CLASSES[normalized],
        className
      )}
    >
      {getPublicationStatusLabel(normalized)}
    </span>
  )
}

export function PublicationStatusSelect({
  value,
  onChange,
  disabled,
  className,
  id,
}: {
  value: unknown
  onChange: (status: PublicationStatus) => void
  disabled?: boolean
  className?: string
  id?: string
}) {
  return (
    <select
      id={id}
      value={normalizePublicationStatus(value)}
      disabled={disabled}
      onChange={(e) => onChange(normalizePublicationStatus(e.target.value))}
      className={cn(
        'border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground outline-none focus:border-jisra-green focus:ring-2 focus:ring-jisra-green disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
    >
      {PUBLICATION_STATUS_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
