import type { Metadata } from 'next'
import { PageHero } from '@/components/marketing/shared/page-hero'
import { Container } from '@/components/marketing/shared/container'
import { MotionSection } from '@/components/marketing/shared/motion-section'
import { Card3D } from '@/components/marketing/shared/card-3d'

export const metadata: Metadata = {
  title: 'À propos',
  description: 'Découvrez la mission de jisra et sa vision pour les e-commerçants marocains.',
}

const values = [
  'Clarté business',
  'Automatisation utile',
  'Ancrage marché marocain',
  'Décision guidée par la donnée',
]

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="À propos"
        title="Construire l’ERP que les e-commerçants marocains méritent"
        description="jisra naît d’un constat simple : trop d’entreprises pilotent encore leur croissance avec des outils éclatés, sans vue claire du profit réel."
        image="/marketing/about-mission.webp"
      />

      <MotionSection className="py-20 sm:py-24" withStagger>
        <Container className="grid gap-6 lg:grid-cols-2">
          <Card3D className="p-8">
            <h2 className="text-2xl font-semibold text-jisra-cream">Notre mission</h2>
            <p className="mt-4 text-base leading-8 text-jisra-cream/70">
              Donner aux marchands marocains une lecture unifiée de leurs ventes, de leurs dépenses et de leurs opérations pour qu’ils puissent scaler avec confiance.
            </p>
          </Card3D>
          <Card3D className="p-8">
            <h2 className="text-2xl font-semibold text-jisra-cream">Notre vision</h2>
            <p className="mt-4 text-base leading-8 text-jisra-cream/70">
              Créer la référence ERP orientée rentabilité réelle pour le Maroc, puis pour les marchés e-commerce francophones qui partagent les mêmes contraintes terrain.
            </p>
          </Card3D>
        </Container>
      </MotionSection>

      <MotionSection className="py-20 sm:py-24" withStagger>
        <Container className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {values.map((value) => (
            <Card3D key={value} className="p-6 text-lg font-semibold text-jisra-cream">
              {value}
            </Card3D>
          ))}
        </Container>
      </MotionSection>
    </>
  )
}