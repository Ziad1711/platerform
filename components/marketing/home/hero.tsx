'use client'

import Image from 'next/image'
import { Calculator, Receipt, ShoppingCart, Sparkles, Truck } from 'lucide-react'
import { motion } from 'framer-motion'
import { heroHighlights, logoMarquee, logoMarqueeNotice } from '@/lib/marketing/site'
import { Container } from '@/components/marketing/shared/container'
import { MarketingLink } from '@/components/marketing/shared/marketing-link'
import { MarqueeLogos } from '@/components/marketing/shared/marquee-logos'
import { MotionSection } from '@/components/marketing/shared/motion-section'
import { Spotlight } from '@/components/marketing/shared/spotlight'
import { fadeUp, heroVisualFloat } from '@/lib/marketing/motion'

const highlightIcons = [ShoppingCart, Receipt, Truck, Calculator]

export function HomeHero() {
  return (
    <section className="relative overflow-hidden pb-0 pt-0 text-jisra-cream">
      <Spotlight />

      <Container className="relative z-10">
        <MotionSection withStagger className="grid items-center gap-14 pb-12 pt-8 lg:grid-cols-[0.95fr_1.05fr] lg:py-20">
          <div className="space-y-8">
            <motion.div
              variants={fadeUp}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium uppercase tracking-[0.24em] text-jisra-cream/74"
            >
              <Sparkles className="h-3.5 w-3.5 text-jisra-green-light" />
              conçu pour les marchands marocains qui scalent
            </motion.div>

            <motion.div variants={fadeUp} className="space-y-5">
              <h1 className="max-w-4xl text-balance text-[clamp(1.75rem,4.5vw,3.5rem)] font-extrabold leading-[1.1] tracking-[-0.04em]">
                Vos commandes, vos coûts et votre <span className="text-gradient-brand">profit</span> au même endroit.
              </h1>
              <p className="max-w-2xl text-base leading-8 text-jisra-cream/66 sm:text-lg">
                Jisra rassemble ventes, publicité, livraison et stock pour vous aider à suivre ce que votre activité vous rapporte à partir de vos données.
              </p>
            </motion.div>

            <motion.div variants={fadeUp} className="flex flex-col gap-3 sm:flex-row">
              <MarketingLink href="/signup">Créer mon compte</MarketingLink>
              <MarketingLink href="/pricing" variant="ghost">
                Voir les tarifs
              </MarketingLink>
            </motion.div>

            <motion.div variants={fadeUp} className="grid gap-3 sm:grid-cols-2">
              {heroHighlights.map((item, index) => {
                const Icon = highlightIcons[index]
                return (
                  <div
                    key={item.title}
                    className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0 text-jisra-green-light" aria-hidden="true" />
                      <p className="text-sm font-semibold text-jisra-cream">{item.title}</p>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-jisra-cream/58">{item.description}</p>
                  </div>
                )
              })}
            </motion.div>
          </div>

          <motion.div variants={heroVisualFloat} initial="initial" animate="animate" className="relative will-change-transform">
            <div className="marketing-panel marketing-noise overflow-hidden p-3 sm:p-4">
              <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-[#0b100e]">
                <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/20 px-4 py-3 backdrop-blur-xl">
                  <div>
                    <p className="text-sm font-semibold text-jisra-cream">Vue consolidée jisra</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-jisra-cream/42">profit · ops · ads · delivery</p>
                  </div>
                  <div className="rounded-full border border-jisra-green/20 bg-jisra-green/10 px-3 py-1 text-[11px] font-mono text-jisra-green-light">
                    LIVE DATA
                  </div>
                </div>

                <Image
                  src="/marketing/hero-main.webp"
                  alt="Illustration premium du cockpit jisra montrant commandes, profit, publicite et livraison"
                  width={1600}
                  height={1000}
                  priority
                  className="aspect-[16/10] h-auto w-full object-cover"
                />
              </div>
            </div>
          </motion.div>
        </MotionSection>

        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          className="space-y-3"
        >
          <p className="text-center text-sm leading-6 text-jisra-cream/62">{logoMarqueeNotice}</p>
          <MarqueeLogos items={logoMarquee} />
        </motion.div>
      </Container>
    </section>
  )
}