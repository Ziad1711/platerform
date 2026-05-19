'use client'

import { useState } from 'react'
import { Calendar, ChevronDown } from 'lucide-react'
import { useStore } from '@/lib/store-context'
import type { DashboardPeriod } from '@/lib/utils'

const periods = [
  { id: 'today', label: 'Aujourd\'hui' },
  { id: 'yesterday', label: 'Hier' },
  { id: 'week', label: 'Cette semaine' },
  { id: 'month', label: 'Ce mois' },
  { id: 'quarter', label: 'Ce trimestre' },
  { id: 'year', label: 'Cette année' },
  { id: 'all_time', label: 'Maximum' },
  { id: 'custom', label: 'Période personnalisée' },
]

const periodLabels: Record<DashboardPeriod, string> = {
  today: "Aujourd'hui",
  yesterday: 'Hier',
  week: 'Cette semaine',
  month: 'Ce mois',
  quarter: 'Ce trimestre',
  year: 'Cette année',
  all_time: 'Maximum',
  custom: 'Période personnalisée',
}

export default function PeriodFilter() {
  const {
    selectedPeriod,
    setSelectedPeriod,
    customStartDate,
    setCustomStartDate,
    customEndDate,
    setCustomEndDate,
  } = useStore()
  const [isOpen, setIsOpen] = useState(false)
  
  // Local state for custom dates to avoid intermediate re-renders/fetches
  const [localStartDate, setLocalStartDate] = useState<string | null>(customStartDate)
  const [localEndDate, setLocalEndDate] = useState<string | null>(customEndDate)

  const handleApplyCustom = () => {
    // Only apply and close if we have both dates
    if (localStartDate && localEndDate) {
      // First set the dates
      setCustomStartDate(localStartDate)
      setCustomEndDate(localEndDate)
      // Then change the period mode to trigger the fetch
      setSelectedPeriod('custom')
      setIsOpen(false)
    }
  }

  const selectedLabel = selectedPeriod === 'custom' && customStartDate && customEndDate
    ? `${customStartDate} → ${customEndDate}`
    : periodLabels[selectedPeriod] || 'Période'

  return (
    <div className="relative">
      <button
        onClick={() => {
          if (!isOpen) {
            setLocalStartDate(customStartDate)
            setLocalEndDate(customEndDate)
          }
          setIsOpen(!isOpen)
        }}
        className="w-full sm:w-auto sm:min-w-[190px] max-w-[220px] flex items-center justify-between gap-2 px-4 py-2 bg-card border border-border rounded-lg hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary text-foreground"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <span className="truncate">{selectedLabel}</span>
        </span>
        <ChevronDown className="w-4 h-4 text-muted-foreground" />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-72 bg-card rounded-lg shadow-lg border border-border z-20">
            <div className="py-1">
              {periods.map((period) => (
                <button
                  key={period.id}
                  onClick={() => {
                    if (period.id !== 'custom') {
                      setSelectedPeriod(period.id as DashboardPeriod)
                      setIsOpen(false)
                    } else {
                      // If clicking custom, don't set period yet, just stay open to pick dates
                      // We don't call setSelectedPeriod here to prevent eager fetch
                    }
                  }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-secondary ${
                    (selectedPeriod === period.id || (period.id === 'custom' && !['today', 'yesterday', 'week', 'month', 'quarter', 'year', 'all_time'].includes(selectedPeriod)))
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground'
                  }`}
                >
                  {period.label}
                </button>
              ))}

              <div className="px-4 py-3 border-t border-border space-y-3">
                <div className="text-xs font-semibold text-primary uppercase tracking-wider mb-2">Dates personnalisées</div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Date début</label>
                  <input
                    type="date"
                    value={localStartDate || ''}
                    onChange={(e) => setLocalStartDate(e.target.value || null)}
                    className="w-full border border-border rounded px-2 py-1.5 text-sm bg-card text-foreground"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Date fin</label>
                  <input
                    type="date"
                    value={localEndDate || ''}
                    onChange={(e) => setLocalEndDate(e.target.value || null)}
                    className="w-full border border-border rounded px-2 py-1.5 text-sm bg-card text-foreground"
                  />
                </div>
                <button
                  onClick={handleApplyCustom}
                  disabled={!localStartDate || !localEndDate}
                  className="w-full bg-primary text-white text-sm font-medium py-2 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Appliquer
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}