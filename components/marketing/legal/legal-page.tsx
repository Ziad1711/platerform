import { Container } from '@/components/marketing/shared/container'
import { PageHero } from '@/components/marketing/shared/page-hero'
import { MotionSection } from '@/components/marketing/shared/motion-section'
import { Card3D } from '@/components/marketing/shared/card-3d'

type LegalPageProps = {
  eyebrow: string
  title: string
  updatedAt: string
  sections: Array<{ title: string; content: string[] }>
}

export function LegalPage({ eyebrow, title, updatedAt, sections }: LegalPageProps) {
  return (
    <>
      <PageHero eyebrow={eyebrow} title={title} description={`Version initiale fournie à titre informatif. Dernière mise à jour : ${updatedAt}.`} />
      <MotionSection className="py-20 sm:py-24" withStagger>
        <Container className="max-w-4xl space-y-8">
          {sections.map((section) => (
            <Card3D key={section.title} className="p-8">
              <h2 className="text-2xl font-semibold text-jisra-cream">{section.title}</h2>
              <div className="mt-4 space-y-4 text-sm leading-7 text-jisra-cream/70">
                {section.content.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </Card3D>
          ))}
        </Container>
      </MotionSection>
    </>
  )
}