import type { Metadata } from 'next'
import Link from 'next/link'
import { BookOpen, CreditCard, HelpCircle, Mail } from 'lucide-react'
import { SITE_URL } from '@/lib/marketing/site-url'
import { PageHero } from '@/components/marketing/shared/page-hero'
import { Container } from '@/components/marketing/shared/container'
import { MotionSection } from '@/components/marketing/shared/motion-section'
import { FaqExperience } from '@/components/marketing/faq/faq-experience'
import { FaqSuggestForm } from '@/components/marketing/faq/faq-suggest-form'

export const metadata: Metadata = {
  title: 'FAQ — Questions fréquentes',
  description:
    'Réponses vérifiées sur Jisra : offres et tarifs, commandes et confirmation, livraison, stock, publicité, assistant IA, intégrations, sécurité et assistance.',
  alternates: {
    canonical: `${SITE_URL}/faq`,
  },
  openGraph: {
    title: 'FAQ Jisra — Questions fréquentes',
    description:
      'Offres, commandes, livraison, stock, publicité, assistant IA et sécurité : les réponses vérifiées aux questions les plus fréquentes.',
    url: `${SITE_URL}/faq`,
    type: 'website',
    locale: 'fr_MA',
  },
}

const resourceLinks = [
  { href: '/pricing', label: 'Forfaits et tarifs', description: 'Comparer les offres et les quotas.', icon: CreditCard },
  { href: '/features', label: 'Fonctionnalités', description: 'Le détail des modules Jisra.', icon: BookOpen },
  { href: '/catalogue-integrations', label: 'Intégrations', description: 'Boutiques et transporteurs connectables.', icon: HelpCircle },
  { href: '/contact', label: 'Contacter l’équipe', description: 'Une question absente de la FAQ ?', icon: Mail },
]

export default function FaqPage() {
  return (
    <>
      <PageHero
        eyebrow="FAQ"
        title="Toutes les réponses sur Jisra"
        description="Offres, commandes, livraison, stock, publicité, assistant IA et sécurité : retrouvez les réponses vérifiées aux questions les plus fréquentes."
      />

      <MotionSection className="pb-16 sm:pb-20" withStagger>
        <Container>
          <FaqExperience />
        </Container>
      </MotionSection>

      <MotionSection className="pb-16 sm:pb-20" withStagger>
        <Container>
          <FaqSuggestForm />
        </Container>
      </MotionSection>

      <MotionSection className="pb-20 sm:pb-24" withStagger>
        <Container className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {resourceLinks.map((link) => {
            const Icon = link.icon
            return (
              <Link
                key={link.href}
                href={link.href}
                className="marketing-panel group flex flex-col gap-3 p-5 transition hover:border-jisra-green/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jisra-green"
              >
                <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-jisra-green/10">
                  <Icon className="h-5 w-5 text-jisra-green" />
                </span>
                <span className="text-sm font-semibold text-jisra-cream">{link.label}</span>
                <span className="text-xs leading-6 text-jisra-cream/55">{link.description}</span>
              </Link>
            )
          })}
        </Container>
      </MotionSection>
    </>
  )
}
