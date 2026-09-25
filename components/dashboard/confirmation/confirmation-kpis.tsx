'use client'

import { formatNumber } from '@/lib/utils'

type ConfirmationKpisProps = {
  counts: Record<string, number>
  activeFilter: string
  onSelectFilter: (filter: string) => void
}

type KpiDefinition = {
  key: string
  label: string
  filter?: string
  tone: string
}

const KPIS: KpiDefinition[] = [
  { key: 'to_process', label: 'À traiter', filter: 'to_process', tone: 'text-blue-600' },
  { key: 'to_callback', label: 'À rappeler', filter: 'to_callback', tone: 'text-cyan-600' },
  { key: 'late', label: 'En retard', filter: 'late', tone: 'text-amber-600' },
  { key: 'pendingTotal', label: 'Restant à confirmer', tone: 'text-slate-700' },
  { key: 'confirmedToday', label: 'Confirmées aujourd’hui', tone: 'text-emerald-600' },
  { key: 'cancelledToday', label: 'Annulées aujourd’hui', tone: 'text-rose-600' },
]

export default function ConfirmationKpis({ counts, activeFilter, onSelectFilter }: ConfirmationKpisProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
      {KPIS.map((kpi) => {
        const isActive = kpi.filter && kpi.filter === activeFilter
        const isClickable = Boolean(kpi.filter)

        return (
          <button
            key={kpi.key}
            type="button"
            disabled={!isClickable}
            onClick={() => (kpi.filter ? onSelectFilter(kpi.filter) : undefined)}
            className={`text-left rounded-lg border p-3 transition-colors ${
              isActive
                ? 'border-primary bg-primary/5'
                : 'border-border bg-card'
            } ${isClickable ? 'hover:bg-secondary/60 cursor-pointer' : 'cursor-default'}`}
          >
            <div className="text-xs text-muted-foreground">{kpi.label}</div>
            <div className={`mt-1 text-2xl font-bold ${kpi.tone}`}>
              {formatNumber(Number(counts?.[kpi.key] || 0))}
            </div>
          </button>
        )
      })}
    </div>
  )
}
