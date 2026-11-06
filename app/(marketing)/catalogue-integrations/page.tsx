import type { Metadata } from 'next'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { SITE_URL } from '@/lib/marketing/site-url'
import { getPublicIntegrationProviders } from '@/lib/integrations/public-catalog'
import { PageHero } from '@/components/marketing/shared/page-hero'
import { Container } from '@/components/marketing/shared/container'
import { MotionSection } from '@/components/marketing/shared/motion-section'
import { MarketingLink } from '@/components/marketing/shared/marketing-link'
import { IntegrationFlow } from '@/components/marketing/integrations/integration-flow'
import { IntegrationsCatalog } from '@/components/marketing/integrations/integrations-catalog'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Catalogue des intégrations',
  description:
    'Toutes les intégrations disponibles dans jisra : boutiques YouCan et Lightfunnels, Facebook Ads, transporteurs marocains, API site web personnalisé.',
  alternates: {
    canonical: `${SITE_URL}/catalogue-integrations`,
  },
}

export default async function IntegrationsCataloguePage() {
  const providers = await getPublicIntegrationProviders()

  const deliveryCount = providers.filter((provider) => provider.category === 'delivery').length
  const storeCount = providers.filter((provider) => provider.category === 'ecommerce').length

  const heroStats = [
    { value: `+${providers.length}`, label: 'intégrations disponibles' },
    { value: '1 clic', label: 'pour connecter un outil' },
    { value: '0 code', label: 'à écrire' },
  ]

  const heroHighlights = [
    storeCount > 0
      ? `${storeCount} plateformes e-commerce synchronisées`
      : 'Boutiques e-commerce synchronisées',
    deliveryCount > 0
      ? `${deliveryCount} transporteurs : colis, étiquettes et suivi`
      : 'Transporteurs : colis, étiquettes et suivi',
    'Publicité rattachée aux produits et aux commandes',
    'API prête pour votre site personnalisé',
  ]

  const heroExtra = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {heroStats.map((stat, index) => (
          <div
            key={stat.label}
            className={`rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 ${
              index === heroStats.length - 1 ? 'col-span-2 text-center sm:col-span-1 sm:text-left' : ''
            }`}
          >
            <p className="text-xl font-semibold text-jisra-green">{stat.value}</p>
            <p className="mt-1 text-xs leading-5 text-jisra-cream/55">{stat.label}</p>
          </div>
        ))}
      </div>
      <ul className="grid gap-x-6 gap-y-2 text-sm text-jisra-cream/70 sm:grid-cols-2">
        {heroHighlights.map((highlight) => (
          <li key={highlight} className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-jisra-green" />
            <span>{highlight}</span>
          </li>
        ))}
      </ul>
    </div>
  )

  return (
    <>
      <PageHero
        eyebrow="Intégrations"
        title="Toutes les intégrations disponibles dans jisra"
        description="Boutiques, transporteurs, publicité et API : connectez les outils que vous utilisez déjà et retrouvez leurs données au même endroit."
        titleClassName="text-3xl sm:text-4xl lg:text-[42px]"
        className="pt-6 pb-12 sm:pt-8 sm:pb-14 lg:pt-10"
        extra={heroExtra}
        visual={<IntegrationFlow items={providers} />}
      />

      <IntegrationsCatalog providers={providers} />

      <MotionSection className="pb-20 pt-6 sm:pb-24">
        <Container>
          <div className="marketing-panel marketing-noise overflow-hidden px-6 py-10 text-jisra-cream sm:px-10 sm:py-12">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(31,169,113,0.22),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(198,139,60,0.18),transparent_24%)]" />
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl space-y-3">
                <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-jisra-green">
                  Passer à l’action
                </div>
                <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Une intégration vous manque ?</h2>
                <p className="text-base leading-8 text-jisra-cream/65">
                  Créez votre compte pour connecter vos outils, ou écrivez-nous pour étudier l’intégration dont vous avez besoin.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <MarketingLink href="/signup">Créer mon compte</MarketingLink>
                <MarketingLink href="/contact" variant="ghost">
                  Parler à l’équipe
                </MarketingLink>
              </div>
            </div>
          </div>
          <p className="mt-6 text-center text-sm text-jisra-cream/48">
            Les intégrations se connectent depuis votre espace jisra.{' '}
            <Link href="/features" className="text-jisra-green transition-colors hover:text-jisra-green-light">
              Voir les fonctionnalités
            </Link>
          </p>
        </Container>
      </MotionSection>
    </>
  )
}
