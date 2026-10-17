import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/marketing/site-url'
import { PricingPlans } from '@/components/marketing/pricing/pricing-plans'

export const metadata: Metadata = {
  title: 'Tarifs — ERP e-commerce pour le Maroc',
  description:
    'Comparez les plans jisra pour e-commerçants marocains : commandes, stock, publicité, livraison et rentabilité dans une seule interface. Sans frais cachés ni engagement.',
  alternates: {
    canonical: `${SITE_URL}/pricing`,
  },
}

export default function PricingPage() {
  return <PricingPlans />
}
