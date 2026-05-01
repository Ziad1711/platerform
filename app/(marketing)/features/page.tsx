import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { featurePages, integrations, modules } from '@/lib/marketing/site'
import { PageHero } from '@/components/marketing/shared/page-hero'
import { Container } from '@/components/marketing/shared/container'
import { Card3D } from '@/components/marketing/shared/card-3d'
import { MotionSection } from '@/components/marketing/shared/motion-section'

export const metadata: Metadata = {
  title: 'Fonctionnalités',
  description: 'Explorez les modules jisra : ventes, publicité, livraison, stock, assistant IA et multi-stores.',
}

export default function FeaturesPage() {
  return (
    <>
      <PageHero
        eyebrow="Fonctionnalités"
        title="Un cockpit e-commerce complet, orienté exécution et rentabilité"
        description="Chaque brique de jisra partage la même source de vérité pour que les décisions suivent enfin le rythme de vos opérations."
        image="/marketing/feature-automation.webp"
      />

      <MotionSection className="py-20 sm:py-24" withStagger>
        <Container className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
          {featurePages.map((feature) => (
            <Card3D
              key={feature.slug}
              className="overflow-hidden"
            >
              <Link href={`/features/${feature.slug}`}>
                <div className="relative aspect-[4/3] overflow-hidden border-b border-white/10">
                  <Image src={feature.image} alt={feature.title} fill className="object-cover" />
                </div>
                <div className="p-6">
                  <h2 className="text-xl font-semibold text-jisra-cream">{feature.title}</h2>
                  <p className="mt-3 text-sm leading-7 text-jisra-cream/65">{feature.description}</p>
                </div>
              </Link>
            </Card3D>
          ))}
        </Container>
      </MotionSection>

      <MotionSection id="integrations" className="py-20 sm:py-24" withStagger>
        <Container className="grid gap-5 lg:grid-cols-3">
          {integrations.map((integration) => (
            <Card3D key={integration.name} className="p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-jisra-cream">{integration.name}</h2>
                <span className="rounded-full bg-jisra-green/10 px-3 py-1 text-xs font-semibold text-jisra-green">
                  {integration.status}
                </span>
              </div>
            </Card3D>
          ))}
        </Container>
      </MotionSection>

      <MotionSection className="py-20 text-jisra-cream sm:py-24" withStagger>
        <Container className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {modules.map((module) => (
            <div key={module} className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-sm font-medium">
              {module}
            </div>
          ))}
        </Container>
      </MotionSection>
    </>
  )
}