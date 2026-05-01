'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { fadeUp } from '@/lib/marketing/motion'

type SectionHeadingProps = {
  eyebrow?: string
  title: string
  description?: string
  align?: 'left' | 'center'
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'left',
}: SectionHeadingProps) {
  return (
    <motion.div
      className={cn('space-y-4', align === 'center' && 'mx-auto max-w-3xl text-center')}
      variants={fadeUp}
    >
      {eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-jisra-green-light">{eyebrow}</p>
      ) : null}
      <h2 className="text-balance text-3xl font-bold tracking-[-0.04em] text-jisra-cream sm:text-4xl lg:text-5xl">{title}</h2>
      {description ? <p className="text-base leading-8 text-jisra-cream/66 sm:text-lg">{description}</p> : null}
    </motion.div>
  )
}