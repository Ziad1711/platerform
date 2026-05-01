'use client'

import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { pageTransition } from '@/lib/marketing/motion'

type PageTransitionProps = {
  children: ReactNode
}

export function PageTransition({ children }: PageTransitionProps) {
  return (
    <motion.div initial="initial" animate="animate" exit="exit" variants={pageTransition}>
      {children}
    </motion.div>
  )
}