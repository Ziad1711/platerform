import type { Metadata } from 'next'
import { LegalPage } from '@/components/marketing/legal/legal-page'

export const metadata: Metadata = {
  title: 'Mentions légales',
  description: 'Mentions légales initiales du site marketing jisra.',
}

export default function MentionsPage() {
  return (
    <LegalPage
      eyebrow="Légal"
      title="Mentions légales"
      updatedAt="28 avril 2026"
      sections={[
        {
          title: 'Éditeur',
          content: [
            'Le site jisra est publié à titre professionnel pour présenter la plateforme ERP dédiée aux e-commerçants marocains.',
            'Les coordonnées définitives de l’éditeur et de l’hébergeur seront complétées dans la version légale finale validée.',
          ],
        },
        {
          title: 'Propriété intellectuelle',
          content: [
            'Les contenus, la marque jisra, les éléments graphiques et les textes présents sur ce site sont protégés.',
            'Toute reproduction substantielle sans autorisation préalable est interdite.',
          ],
        },
      ]}
    />
  )
}