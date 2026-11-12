'use client'

import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { MessageCircle } from 'lucide-react'
import { CatalogOffers, publicCatalogQuery } from './catalog-offers'
import { PageHero } from '@/components/marketing/shared/page-hero'
import { Container } from '@/components/marketing/shared/container'
import { MarketingLink } from '@/components/marketing/shared/marketing-link'
import { MotionSection } from '@/components/marketing/shared/motion-section'
import { PricingComparison } from '@/components/marketing/pricing/pricing-comparison'
import { PricingFAQ } from '@/components/marketing/pricing/pricing-faq'

export function PricingPlans() {
  const { data: catalog = [] } = useQuery(publicCatalogQuery)
  const plans = catalog.filter((price) => price.billing_period === 'monthly')

  return (
    <>
      <PageHero
        eyebrow="Tarifs"
        title="Des plans simples pour transformer vos opérations en machine rentable"
        description="Choisissez un cadre adapté à votre phase de croissance. Mensuel ou annuel prépayé, avec un montant total clairement indiqué."
      />

      <MotionSection className="py-20 sm:py-24" withStagger>
        <Container className="space-y-10">
          <CatalogOffers />
        </Container>
      </MotionSection>

      {plans.length > 0 && (
        <MotionSection className="py-20 sm:py-24" withStagger>
          <Container className="space-y-10">
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-jisra-green-light">
                Comparaison
              </p>
              <h2 className="mt-3 text-3xl font-bold tracking-[-0.04em] text-jisra-cream sm:text-4xl">
                Toutes les fonctionnalités en détail
              </h2>
            </div>
            <PricingComparison plans={plans} />
          </Container>
        </MotionSection>
      )}

      <MotionSection className="py-20 sm:py-24" withStagger>
        <Container className="space-y-10">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-jisra-green-light">
              FAQ
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-[-0.04em] text-jisra-cream sm:text-4xl">
              Questions fréquentes
            </h2>
          </div>
          <PricingFAQ />
        </Container>
      </MotionSection>

      <MotionSection className="py-20 sm:py-24" withStagger>
        <Container>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="marketing-panel mx-auto max-w-2xl p-10 text-center"
          >
            <MessageCircle className="mx-auto h-10 w-10 text-jisra-green" />
            <h2 className="mt-4 text-2xl font-bold tracking-[-0.04em] text-jisra-cream sm:text-3xl">
              Une question ? Contactez-nous
            </h2>
            <p className="mt-3 text-sm leading-7 text-jisra-cream/68">
              Notre équipe vous répond sous 24h pour vous aider à choisir le plan adapté à votre activité.
            </p>
            <MarketingLink href="/contact" className="mt-6">
              Nous contacter
            </MarketingLink>
          </motion.div>
        </Container>
      </MotionSection>
    </>
  )
}
