import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/marketing/site-url'
import { PricingPlans } from '@/components/marketing/pricing/pricing-plans'

export const metadata: Metadata = {
  title: 'Tarifs — ERP e-commerce pour le Maroc',
  description:
    'Comparez les forfaits Jisra : mensuel ou annuel prépayé, avec montant total indiqué. Commandes, stock, publicité, livraison et rentabilité.',
  alternates: {
    canonical: `${SITE_URL}/pricing`,
  },
}

export default function PricingPage() {
  return <PricingPlans />
}
