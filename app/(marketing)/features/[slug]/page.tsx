import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { SITE_URL } from '@/lib/marketing/site-url'
import { featurePages, type FeaturePage } from '@/lib/marketing/site'
import { PageHero } from '@/components/marketing/shared/page-hero'
import { Container } from '@/components/marketing/shared/container'
import { MarketingLink } from '@/components/marketing/shared/marketing-link'
import { MotionSection } from '@/components/marketing/shared/motion-section'
import { Card3D } from '@/components/marketing/shared/card-3d'

type FeaturePageProps = {
  params: Promise<{ slug: string }>
}

type FeatureSection = NonNullable<FeaturePage['content']>[number]

function groupSections(sections: FeatureSection[]) {
  return sections.reduce<Array<{ section: FeatureSection; subsections: FeatureSection[] }>>((groups, section) => {
    const lastGroup = groups[groups.length - 1]

    if (section.level === 3 && lastGroup) {
      lastGroup.subsections.push(section)
      return groups
    }

    groups.push({ section, subsections: [] })
    return groups
  }, [])
}

function SectionContent({ section }: { section: FeatureSection }) {
  return (
    <>
      {section.paragraphs.map((paragraph) => (
        <p key={paragraph} className="text-base leading-8 text-jisra-cream/70">
          {paragraph}
        </p>
      ))}
      {section.links && section.links.length > 0 ? (
        <ul className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap sm:gap-x-6">
          {section.links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="inline-flex items-center gap-2 text-sm font-medium text-jisra-green transition-colors hover:text-jisra-green-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jisra-green/60 focus-visible:ring-offset-2 focus-visible:ring-offset-jisra-ink"
              >
                {link.label}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}

export async function generateMetadata({ params }: FeaturePageProps): Promise<Metadata> {
  const { slug } = await params
  const feature = featurePages.find((item) => item.slug === slug)

  if (!feature) {
    return {}
  }

  return {
    title: feature.seoTitle ?? feature.title,
    description: feature.seoDescription ?? feature.description,
    alternates: {
      canonical: `${SITE_URL}/features/${feature.slug}`,
    },
  }
}

export default async function FeatureDetailPage({ params }: FeaturePageProps) {
  const { slug } = await params
  const feature = featurePages.find((item) => item.slug === slug)

  if (!feature) {
    notFound()
  }

  const heroTitle = feature.h1 ?? feature.title
  const heroDescription = feature.heroDescription ?? feature.description
  const valueText =
    feature.valueText ??
    `${feature.description} jisra relie ce module au reste de votre système pour éviter les doubles saisies, accélérer l’exécution et fiabiliser la lecture du profit.`

  return (
    <>
      <PageHero eyebrow="Module" title={heroTitle} description={heroDescription} image={feature.image} />

      {feature.content ? (
        <MotionSection className="pb-20 sm:pb-24" withStagger>
          <Container>
            <div className="max-w-3xl space-y-10 text-jisra-cream">
              {groupSections(feature.content).map(({ section, subsections }) => {
                const SectionHeading = section.level === 3 ? 'h3' : 'h2'

                return (
                  <div key={section.heading} className="space-y-4">
                    <SectionHeading
                      className={
                        section.level === 3
                          ? 'text-xl font-semibold tracking-tight text-jisra-cream'
                          : 'text-2xl font-semibold tracking-tight text-jisra-cream sm:text-3xl'
                      }
                    >
                      {section.heading}
                    </SectionHeading>
                    <SectionContent section={section} />
                    {subsections.map((subsection) => (
                      <div key={subsection.heading} className="space-y-4 pt-2">
                        <h3 className="text-xl font-semibold tracking-tight text-jisra-cream">{subsection.heading}</h3>
                        <SectionContent section={subsection} />
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </Container>
        </MotionSection>
      ) : null}

      <MotionSection className="py-20 sm:py-24" withStagger>
        <Container className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card3D className="overflow-hidden">
            <div className="relative aspect-[16/10] overflow-hidden border-b border-white/10">
              <Image src={feature.image} alt={feature.title} fill className="object-cover" />
            </div>
            <div className="p-8">
              <h2 className="text-2xl font-semibold text-jisra-cream">Pourquoi ce module compte</h2>
              <p className="mt-4 text-base leading-8 text-jisra-cream/70">{valueText}</p>
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