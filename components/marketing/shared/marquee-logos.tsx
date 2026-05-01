'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

type MarqueeLogosProps = {
  items: string[]
  className?: string
}

export function MarqueeLogos({ items, className }: MarqueeLogosProps) {
  const duplicated = [...items, ...items]

  return (
    <div className={cn('relative overflow-hidden rounded-full border border-white/10 bg-white/[0.03] py-3', className)}>
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-jisra-ink to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-jisra-ink to-transparent" />
      <motion.div
        className="flex min-w-max items-center gap-3 px-3"
        animate={{ x: ['0%', '-50%'] }}
        transition={{ duration: 18, ease: 'linear', repeat: Infinity }}
      >
        {duplicated.map((item, index) => (
          <div
            key={`${item}-${index}`}
            className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-jisra-cream/68"
          >
            {item}
          </div>
        ))}
      </motion.div>
    </div>
  )
}