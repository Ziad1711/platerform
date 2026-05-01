'use client'

import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

type Card3DProps = {
  children: ReactNode
  className?: string
}

export function Card3D({ children, className }: Card3DProps) {
  return (
    <motion.div
      whileHover={{ y: -6, rotateX: 4, rotateY: -4, scale: 1.01 }}
      transition={{ duration: 0.25 }}
      className={cn('transform-gpu rounded-[28px] border border-white/10 bg-white/[0.04] shadow-[0_24px_80px_rgba(0,0,0,0.22)] backdrop-blur-xl', className)}
      style={{ transformStyle: 'preserve-3d' }}
    >
      {children}
    </motion.div>
  )
}