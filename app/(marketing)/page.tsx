import type { Metadata } from 'next'
import { HomeHero } from '@/components/marketing/home/hero'
import { HomeSections } from '@/components/marketing/home/sections'

export const metadata: Metadata = {
  title: 'L’ERP qui calcule votre vrai profit',
  description:
    'jisra aide les e-commerçants marocains à centraliser commandes, stock, publicité et livraison pour piloter leur rentabilité réelle.',
}

export default function MarketingHomePage() {
  return (
    <>
      <HomeHero />
      <HomeSections />
    </>
  )
}
