import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/marketing/site-url'
import { HomeHero } from '@/components/marketing/home/hero'
import { HomeSections } from '@/components/marketing/home/sections'

export const metadata: Metadata = {
  title: 'L’ERP qui calcule votre vrai profit',
  description:
    'jisra aide les e-commerçants marocains à centraliser commandes, stock, publicité et livraison pour piloter leur rentabilité réelle.',
  alternates: {
    canonical: `${SITE_URL}/`,
  },
}

export default function MarketingHomePage() {
  return (
    <>
      <HomeHero />
      <HomeSections />
    </>
  )
}
