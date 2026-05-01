'use client'

import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { fadeUp, staggerContainer, viewportOnce } from '@/lib/marketing/motion'

type MotionSectionProps = {
  children: ReactNode
  as?: 'section' | 'div'
  withStagger?: boolean
  delayChildren?: number
  staggerChildren?: number
  className?: string
  id?: string
}

export function MotionSection({
  children,
  className,
  as = 'section',
  withStagger = false,
  delayChildren = 0,
  staggerChildren = 0.08,
  id,
}: MotionSectionProps) {
  const Component = as === 'div' ? motion.div : motion.section

  return (
    <Component
      id={id}
      className={cn(className)}
      initial="hidden"
      whileInView="visible"
      viewport={viewportOnce}
      variants={withStagger ? staggerContainer(staggerChildren, delayChildren) : fadeUp}
    >
      {children}
    </Component>
  )
}