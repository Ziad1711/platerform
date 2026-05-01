'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

type AnimatedButtonProps = {
  href: string
  children: ReactNode
  className?: string
  variant?: 'primary' | 'secondary' | 'ghost'
}

const variants = {
  primary:
    'bg-jisra-green text-white shadow-[0_12px_40px_rgba(31,169,113,0.24)] hover:bg-jisra-green-light',
  secondary:
    'bg-white/10 text-jisra-cream border border-white/10 hover:bg-white/14',
  ghost:
    'border border-white/10 bg-white/[0.03] text-jisra-cream hover:bg-white/[0.07]',
}

export function AnimatedButton({ href, children, className, variant = 'primary' }: AnimatedButtonProps) {
  return (
    <motion.div whileHover={{ scale: 1.02, y: -1 }} whileTap={{ scale: 0.985 }}>
      <Link
        href={href}
        className={cn(
          'group relative inline-flex min-h-11 items-center justify-center overflow-hidden rounded-2xl px-5 py-3 text-sm font-semibold transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jisra-green/40 focus-visible:ring-offset-2 focus-visible:ring-offset-jisra-ink',
          variants[variant],
          className
        )}
      >
        <span className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.24),transparent_55%)]" />
        <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
      </Link>
    </motion.div>
  )
}