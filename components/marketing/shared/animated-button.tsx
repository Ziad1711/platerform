'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

type AnimatedButtonProps = {
  href: string
  children: ReactNode
  className?: string
  wrapperClassName?: string
  variant?: 'primary' | 'secondary' | 'ghost' | 'primarySolid'
}

const variants = {
  // Vert Jisra avec texte encre : 4,93:1 (7,52:1 au survol) — blanc sur vert tombe à 3:1.
  primary:
    'bg-jisra-green text-jisra-ink shadow-[0_12px_40px_rgba(31,169,113,0.24)] hover:bg-jisra-green-light hover:text-jisra-ink active:bg-jisra-green-light active:brightness-[0.97] focus-visible:ring-jisra-cream/80',
  // Variante à texte blanc : vert assombri pour garder 5,34:1 (AA).
  primarySolid:
    'bg-[#157a50] text-white shadow-[0_12px_40px_rgba(21,122,80,0.28)] hover:bg-[#126b46] active:bg-[#0f5f3e] focus-visible:ring-jisra-cream/80',
  secondary:
    'bg-white/10 text-jisra-cream border border-white/10 hover:bg-white/[0.18] hover:text-jisra-cream active:bg-white/[0.22] focus-visible:ring-jisra-green/60',
  ghost:
    'border border-white/20 bg-white/[0.06] text-jisra-cream hover:border-white/30 hover:bg-white/[0.12] hover:text-jisra-cream active:bg-white/[0.16] focus-visible:ring-jisra-green/70',
}

export function AnimatedButton({ href, children, className, wrapperClassName, variant = 'primary' }: AnimatedButtonProps) {
  return (
    <motion.div whileHover={{ scale: 1.02, y: -1 }} whileTap={{ scale: 0.985 }} className={cn(wrapperClassName)}>
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