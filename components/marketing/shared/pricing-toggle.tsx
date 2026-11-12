'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

type PricingToggleProps = {
  value: 'monthly' | 'yearly'
  onChange?: (value: 'monthly' | 'yearly') => void
  appearance?: 'marketing' | 'app'
}

export function PricingToggle({ value, onChange, appearance = 'marketing' }: PricingToggleProps) {
  return (
    <div role="group" aria-label="Période de facturation" className={cn('relative inline-flex rounded-full border p-1', appearance === 'app' ? 'border-border bg-secondary' : 'border-white/10 bg-white/[0.04]')}>
      <motion.div
        layout
        transition={{ type: 'spring', stiffness: 340, damping: 28 }}
        className={cn(
          'absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-full bg-jisra-green',
          value === 'monthly' ? 'left-1' : 'left-[calc(50%+2px)]'
        )}
      />
      {[
        ['monthly', 'Mensuel'],
        ['yearly', 'Annuel'],
      ].map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange?.(key as 'monthly' | 'yearly')}
          className={cn(
            'relative z-10 min-h-11 min-w-[110px] rounded-full px-5 py-2.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-jisra-green',
            value === key ? 'text-white' : appearance === 'app' ? 'text-foreground' : 'text-jisra-cream/62'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}