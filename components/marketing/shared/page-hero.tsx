'use client'

import type { ReactNode } from 'react'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { Container } from '@/components/marketing/shared/container'
import { fadeUp } from '@/lib/marketing/motion'
import { Spotlight } from '@/components/marketing/shared/spotlight'
import { cn } from '@/lib/utils'

type PageHeroProps = {
  eyebrow: string
  title: string
  description: string
  image?: string
  /** Visuel animé affiché à droite du titre, utilisé quand aucune image n'est fournie. */
  visual?: ReactNode
  /** Remplace la taille de titre par défaut. */
  titleClassName?: string
  /** Remplace l'espacement vertical par défaut de la section. */
  className?: string
  /** Contenu additionnel affiché sous la description. */
  extra?: ReactNode
}

export function PageHero({ eyebrow, title, description, image, visual, titleClassName, className, extra }: PageHeroProps) {
  return (
    <section className={cn('relative overflow-hidden text-jisra-cream', className ?? 'py-16 sm:py-20 lg:py-24')}>
      <Spotlight />
      <Container className="relative z-10 grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-100px' }} variants={fadeUp} className="space-y-4 lg:max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-jisra-green-light">{eyebrow}</p>
          <h1 className={cn('text-balance font-bold tracking-[-0.05em]', titleClassName ?? 'text-4xl sm:text-5xl lg:text-6xl')}>
            {title}
          </h1>
          <p className="text-lg leading-8 text-jisra-cream/68">{description}</p>
          {extra}
        </motion.div>

        {image ? (
          <motion.div initial={{ opacity: 0, y: 24, scale: 0.97 }} whileInView={{ opacity: 1, y: 0, scale: 1 }} viewport={{ once: true, margin: '-100px' }} transition={{ duration: 0.7 }} className="marketing-panel overflow-hidden p-3">
            <div className="relative aspect-[16/10] overflow-hidden rounded-[24px] border border-white/10 bg-black/20">
              <Image src={image} alt={title} fill className="object-cover" />
            </div>
          </motion.div>
        ) : visual ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            {visual}
          </motion.div>
        ) : null}
      </Container>
    </section>
  )
}
