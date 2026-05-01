'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

type PricingToggleProps = {
  value: 'monthly' | 'yearly'
  onChange?: (value: 'monthly' | 'yearly') => void
}

export function PricingToggle({ value, onChange }: PricingToggleProps) {
  return (
    <div className="relative inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1">
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
          onClick={() => onChange?.(key as 'monthly' | 'yearly')}
          className={cn(
            'relative z-10 min-w-[120px] rounded-full px-5 py-2.5 text-sm font-semibold transition-colors',
            value === key ? 'text-white' : 'text-jisra-cream/62'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}