import type { Metadata } from 'next'
import { LegalPage } from '@/components/marketing/legal/legal-page'

export const metadata: Metadata = {
  title: 'Conditions d’utilisation',
  description: 'Conditions d’utilisation initiales du site marketing et de la plateforme jisra.',
}

export default function ConditionsPage() {
  return (
    <LegalPage
      eyebrow="Légal"
      title="Conditions d’utilisation"
      updatedAt="28 avril 2026"
      sections={[
        {
          title: 'Objet',
          content: [
            'Ces conditions encadrent l’accès au site marketing jisra et l’usage futur de la plateforme SaaS associée.',
            'L’utilisation du site implique l’acceptation des présentes conditions dans leur version en vigueur.',
          ],
        },
        {
          title: 'Accès au service',
          content: [
            'jisra peut faire évoluer, suspendre ou limiter certaines fonctionnalités sans préavis, notamment pendant la phase de déploiement initiale.',
            'L’utilisateur reste responsable des informations qu’il transmet et de la sécurité de ses accès.',
          ],
        },
      ]}
    />
  )
}