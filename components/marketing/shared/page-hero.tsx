'use client'

import Image from 'next/image'
import { motion } from 'framer-motion'
import { Container } from '@/components/marketing/shared/container'
import { fadeUp } from '@/lib/marketing/motion'
import { Spotlight } from '@/components/marketing/shared/spotlight'

type PageHeroProps = {
  eyebrow: string
  title: string
  description: string
  image?: string
}

export function PageHero({ eyebrow, title, description, image }: PageHeroProps) {
  return (
    <section className="relative overflow-hidden py-16 text-jisra-cream sm:py-20 lg:py-24">
      <Spotlight />
      <Container className="relative z-10 grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-100px' }} variants={fadeUp} className="space-y-4 lg:max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-jisra-green-light">{eyebrow}</p>
          <h1 className="text-balance text-4xl font-bold tracking-[-0.05em] sm:text-5xl lg:text-6xl">{title}</h1>
          <p className="text-lg leading-8 text-jisra-cream/68">{description}</p>
        </motion.div>

        {image ? (
          <motion.div initial={{ opacity: 0, y: 24, scale: 0.97 }} whileInView={{ opacity: 1, y: 0, scale: 1 }} viewport={{ once: true, margin: '-100px' }} transition={{ duration: 0.7 }} className="marketing-panel overflow-hidden p-3">
            <div className="relative aspect-[16/10] overflow-hidden rounded-[24px] border border-white/10 bg-black/20">
              <Image src={image} alt={title} fill className="object-cover" />
            </div>
          </motion.div>
        ) : null}
      </Container>
    </section>
  )
}