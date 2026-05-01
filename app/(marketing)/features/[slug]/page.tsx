import Image from 'next/image'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { featurePages } from '@/lib/marketing/site'
import { PageHero } from '@/components/marketing/shared/page-hero'
import { Container } from '@/components/marketing/shared/container'
import { MarketingLink } from '@/components/marketing/shared/marketing-link'
import { MotionSection } from '@/components/marketing/shared/motion-section'
import { Card3D } from '@/components/marketing/shared/card-3d'

type FeaturePageProps = {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: FeaturePageProps): Promise<Metadata> {
  const { slug } = await params
  const feature = featurePages.find((item) => item.slug === slug)

  if (!feature) {
    return {}
  }

  return {
    title: feature.title,
    description: feature.description,
  }
}

export default async function FeatureDetailPage({ params }: FeaturePageProps) {
  const { slug } = await params
  const feature = featurePages.find((item) => item.slug === slug)

  if (!feature) {
    notFound()
  }

  return (
    <>
      <PageHero eyebrow="Module" title={feature.title} description={feature.description} image={feature.image} />

      <MotionSection className="py-20 sm:py-24" withStagger>
        <Container className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card3D className="overflow-hidden">
            <div className="relative aspect-[16/10] overflow-hidden border-b border-white/10">
              <Image src={feature.image} alt={feature.title} fill className="object-cover" />
            </div>
            <div className="p-8">
              <h2 className="text-2xl font-semibold text-jisra-cream">Pourquoi ce module compte</h2>
              <p className="mt-4 text-base leading-8 text-jisra-cream/70">
              {feature.description} jisra relie ce module au reste de votre système pour éviter les doubles saisies, accélérer l’exécution et fiabiliser la lecture du profit.
              </p>
              <ul className="mt-6 space-y-3 text-sm leading-7 text-jisra-cream/72">
                {feature.bullets.map((bullet) => (
                  <li key={bullet}>• {bullet}</li>
                ))}
              </ul>
            </div>
          </Card3D>

          <Card3D className="p-8 text-jisra-cream">
            <h2 className="text-2xl font-semibold">Passez à l’étape suivante</h2>
            <p className="mt-4 text-base leading-8 text-jisra-cream/68">
              Voyez comment jisra peut s’adapter à votre stack, à votre volume et à vos contraintes opérationnelles.
            </p>
            <div className="mt-8 flex flex-col gap-3">
              <MarketingLink href="/login?signup=1">Créer un compte</MarketingLink>
              <MarketingLink href="/contact" variant="ghost">
                Parler à l’équipe
              </MarketingLink>
            </div>
          </Card3D>
        </Container>
      </MotionSection>
    </>
  )
}