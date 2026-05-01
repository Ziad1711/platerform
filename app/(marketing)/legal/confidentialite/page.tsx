import type { Metadata } from 'next'
import { LegalPage } from '@/components/marketing/legal/legal-page'

export const metadata: Metadata = {
  title: 'Politique de confidentialité',
  description: 'Politique de confidentialité initiale du site marketing jisra.',
}

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Légal"
      title="Politique de confidentialité"
      updatedAt="28 avril 2026"
      sections={[
        {
          title: 'Données collectées',
          content: [
            'Le site peut collecter les informations que vous fournissez volontairement, notamment votre email lors d’une prise de contact.',
            'Les données strictement techniques utiles au fonctionnement et à la sécurité du site peuvent également être traitées.',
          ],
        },
        {
          title: 'Finalités',
          content: [
            'Ces données servent à répondre à vos demandes, améliorer le produit et préparer une mise en relation commerciale pertinente.',
            'Elles ne sont pas revendues et restent limitées aux usages liés à jisra.',
          ],
        },
      ]}
    />
  )
}