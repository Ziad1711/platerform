import type { Metadata } from 'next'
import { PageHero } from '@/components/marketing/shared/page-hero'
import { Container } from '@/components/marketing/shared/container'
import { MotionSection } from '@/components/marketing/shared/motion-section'
import { Card3D } from '@/components/marketing/shared/card-3d'
import { AnimatedButton } from '@/components/marketing/shared/animated-button'

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Parlez à l’équipe jisra pour cadrer votre déploiement et vos besoins opérationnels.',
}

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Parlons de votre stack, de vos stores et de votre rentabilité"
        description="Pour cette première version, le contact passe par email. Décrivez votre volume, vos outils et vos objectifs business."
        image="/marketing/about-values.webp"
      />

      <MotionSection className="py-20 sm:py-24" withStagger>
        <Container className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
          <Card3D className="p-8">
            <h2 className="text-2xl font-semibold text-jisra-cream">Nous écrire</h2>
            <p className="mt-4 text-base leading-8 text-jisra-cream/70">
              Envoyez un email à{' '}
              <a className="font-semibold text-jisra-green-light" href="mailto:contact@jisra.app">
                contact@jisra.app
              </a>{' '}
              avec votre store principal, votre volume mensuel et vos outils actuels.
            </p>
            <AnimatedButton
              href="mailto:contact@jisra.app?subject=Demande%20de%20contact%20jisra"
              className="mt-8"
            >
              Ouvrir mon email
            </AnimatedButton>
          </Card3D>

          <Card3D className="p-8 text-jisra-cream">
            <h2 className="text-2xl font-semibold">Ce que vous pouvez partager</h2>
            <ul className="mt-5 space-y-3 text-sm leading-7 text-jisra-cream/68">
              <li>• Nombre de stores et plateformes utilisées</li>
              <li>• Dépenses publicitaires mensuelles</li>
              <li>• Besoins livraison, stock et équipe</li>
              <li>• Urgence de mise en place</li>
            </ul>
          </Card3D>
        </Container>
      </MotionSection>
    </>
  )
}