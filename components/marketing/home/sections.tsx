'use client'

import Image from 'next/image'
import {
  ArrowRight,
  FileSpreadsheet,
  TrendingDown,
  Package,
  LayoutDashboard,
  RefreshCw,
  PackageCheck,
  RefreshCcw,
  Facebook,
  BrainCircuit,
  Calculator,
  ShoppingCart,
  Warehouse,
  BarChart3,
  Receipt,
  Truck,
  Users,
  Bot,
  HelpCircle,
  Check,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  automations,
  faqItems,
  homeFeatureHighlights,
  integrations,
  modules,
  testimonials,
} from '@/lib/marketing/site'
import { getPlans } from '@/services/plans'
import { Container } from '@/components/marketing/shared/container'
import { SectionHeading } from '@/components/marketing/shared/section-heading'
import { MarketingLink } from '@/components/marketing/shared/marketing-link'
import { MotionSection } from '@/components/marketing/shared/motion-section'
import { Card3D } from '@/components/marketing/shared/card-3d'
import { TestimonialsCarousel } from '@/components/marketing/shared/testimonials-carousel'
import { fadeUp } from '@/lib/marketing/motion'
import { WorkflowSection } from '@/components/marketing/workflow-section/WorkflowSection'
import { AiFeatureSection } from './ai-feature-section'
import { AdsIntegrationSection } from './ads-integration-section'
import { NormalizationSection } from './normalization-section'
import { LogisticsSection } from './logistics-section'
import { StoreIntegrationSection } from './store-integration-section'

const problemIcons = [
  FileSpreadsheet,
  TrendingDown,
  Package,
  LayoutDashboard,
]

const problemCards = [
  'Excel éclatés entre ventes, stock et dépenses',
  'ROAS trompeur sans coût réel par commande',
  'Création colis et suivi livraison trop manuels',
  'Pilotage multi-stores sans vue consolidée',
]

const automationIcons = [
  RefreshCw,
  PackageCheck,
  RefreshCcw,
  Facebook,
  BrainCircuit,
  Calculator,
]

const moduleIcons = [
  ShoppingCart,
  Package,
  Warehouse,
  Truck,
  BarChart3,
  Receipt,
  Truck,
  Users,
  Bot,
]

const homePlanFeatures: Record<string, string[]> = {
  Gratuit: [
    'Jusqu\'à 250 commandes / mois',
    '10 000 crédits IA / mois',
    '1 store',
    'Dashboard KPI',
    'Commandes & stock',
  ],
  Pro: [
    'Jusqu\'à 1 000 commandes / mois',
    '50 000 crédits IA / mois',
    '5 stores',
    'Facebook Ads',
    'Profit net par commande',
    'Assistant IA',
    'Livraison automatisée',
  ],
  Ultimate: [
    'Commandes illimitées',
    '100 000 crédits IA / mois',
    'Stores illimités',
    'Tout le plan Pro',
    'Équipe & rôles',
    'Support prioritaire',
    'API access',
  ],
}

export function HomeSections() {
  const { data: plans = [] } = useQuery({
    queryKey: ['plans'],
    queryFn: getPlans,
  })

  return (
    <>
      <MotionSection className="py-20 sm:py-24" withStagger>
        <Container className="space-y-12">
          <SectionHeading
            eyebrow="Le problème"
            title="Vos chiffres sont partout. Vos décisions deviennent lentes."
            description="jisra élimine les zones floues entre commandes, dépenses pub, livraison et stock pour vous donner une lecture nette du business."
          />
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {problemCards.map((item, i) => {
              const Icon = problemIcons[i]
              return (
                <Card3D key={item} className="p-6">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-jisra-green/10">
                    <Icon className="h-6 w-6 text-jisra-green" />
                  </div>
                  <p className="text-base font-medium leading-7 text-jisra-cream">{item}</p>
                </Card3D>
              )
            })}
          </div>
        </Container>
      </MotionSection>

      <WorkflowSection />

      <MotionSection className="py-20 sm:py-28" withStagger>
        <Container className="space-y-12">
          <SectionHeading
            eyebrow="Feature architecture"
            title="Une landing orientée système, pas une simple liste de modules"
            description="Chaque bloc clé du produit mérite sa propre présence visuelle, son rythme et sa preuve opérationnelle."
          />
          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
            {homeFeatureHighlights.map((item) => (
              <Card3D key={item.title} className="overflow-hidden">
                <div className="relative aspect-[4/3] overflow-hidden border-b border-white/10 bg-black/20">
                  <Image src={item.image} alt={item.title} fill className="object-cover" />
                  <div className="absolute left-4 top-4 rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-jisra-cream/72 backdrop-blur-xl">
                    {item.accent}
                  </div>
                </div>
                <div className="p-6">
                  <h3 className="text-xl font-semibold text-jisra-cream">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-jisra-cream/62">{item.description}</p>
                </div>
              </Card3D>
            ))}
          </div>
        </Container>
      </MotionSection>

      <AiFeatureSection />

      <MotionSection className="py-20 text-jisra-cream sm:py-24" withStagger>
        <Container className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div className="space-y-4">
            <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-jisra-green">
              Section — Rentabilité réelle
            </div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Le chiffre d’affaires ne suffit pas. jisra calcule le net.
            </h2>
            <p className="text-lg leading-8 text-jisra-cream/65">
              Revenus − coût produit − publicité − livraison − confirmation. Vous savez enfin ce qui vous enrichit vraiment.
            </p>
          </div>
          <div className="rounded-[2rem] border border-jisra-green/15 bg-white/5 p-6 backdrop-blur-sm">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
                <p className="text-sm text-jisra-cream/50">CA brut</p>
                <p className="mt-2 text-3xl font-semibold">124 800 MAD</p>
              </div>
              <div className="rounded-2xl border border-jisra-green/20 bg-jisra-green/10 p-5">
                <p className="text-sm text-jisra-cream/60">Profit net réel</p>
                <p className="mt-2 text-3xl font-semibold text-jisra-green">28 460 MAD</p>
              </div>
            </div>
            <div className="mt-5 space-y-3 rounded-2xl border border-white/5 bg-jisra-ink/40 p-5 font-mono text-sm text-jisra-cream/72">
              <p>Revenus ................... 124 800 MAD</p>
              <p>Coût produit .............. 58 300 MAD</p>
              <p>Facebook Ads .............. 22 500 MAD</p>
              <p>Livraison ................. 11 240 MAD</p>
              <p>Confirmation .............. 4 300 MAD</p>
              <p className="border-t border-white/10 pt-3 text-jisra-green">Profit net ................ 28 460 MAD</p>
            </div>
          </div>
        </Container>
      </MotionSection>

      <AdsIntegrationSection />

      <NormalizationSection />

      <LogisticsSection />

      <StoreIntegrationSection />

      <MotionSection className="py-20 sm:py-24" withStagger>
        <Container className="space-y-12">
          <SectionHeading
            eyebrow="Automatisations"
            title="Les tâches critiques s’exécutent sans friction"
            description="Chaque automatisation réduit du temps perdu, fiabilise l’exécution et améliore la lecture du business."
          />
          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
            {automations.map((item, i) => {
              const Icon = automationIcons[i]
              return (
                <motion.div key={item} variants={fadeUp} className="marketing-panel p-6">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-jisra-green/10">
                    <Icon className="h-6 w-6 text-jisra-green" />
                  </div>
                  <p className="text-base leading-7 text-jisra-cream/78">{item}</p>
                </motion.div>
              )
            })}
          </div>
        </Container>
      </MotionSection>

      <MotionSection className="py-20 sm:py-24" withStagger>
        <Container className="space-y-12">
          <SectionHeading
            eyebrow="Modules"
            title="Un ERP e-commerce complet, pensé opération business"
            description="Chaque module se branche au même modèle de données pour éviter les doubles saisies et les écarts de lecture."
          />
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {modules.map((module, i) => {
              const Icon = moduleIcons[i]
              return (
                <Card3D key={module} className="p-6">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-jisra-green/10">
                      <Icon className="h-6 w-6 text-jisra-green" />
                    </div>
                    <p className="text-lg font-semibold text-jisra-cream">{module}</p>
                  </div>
                </Card3D>
              )
            })}
          </div>
        </Container>
      </MotionSection>

      <MotionSection className="py-20 sm:py-24" withStagger id="integrations">
        <Container className="space-y-12">
          <SectionHeading
            eyebrow="Intégrations"
            title="Branché à votre stack marocaine"
            description="Commencez avec les intégrations déjà disponibles et préparez la suite sans changer d’outil."
          />

          <div className="rounded-[32px] border border-white/10 bg-white/[0.03] p-4 sm:p-5 lg:p-6">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-white/10 bg-black/20 px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-jisra-cream">Section — Intégrations</p>
                <p className="mt-1 text-sm text-jisra-cream/58">
                  Les connecteurs critiques sont présentés comme une couche produit à part entière, pas comme une simple liste.
                </p>
              </div>
              <div className="rounded-full border border-jisra-green/20 bg-jisra-green/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-jisra-green-light">
                6 connecteurs clés
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {integrations.map((integration) => (
                <Card3D key={integration.name} className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white">
                        <Image
                          src={integration.icon}
                          alt={integration.name}
                          fill
                          className="object-contain p-2"
                        />
                      </div>
                      <div>
                        <p className="text-lg font-semibold text-jisra-cream">{integration.name}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-jisra-cream/42">connecteur business</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-jisra-green/10 px-3 py-1 text-xs font-semibold text-jisra-green">
                      {integration.status}
                    </span>
                  </div>
                  <p className="mt-5 text-sm leading-7 text-jisra-cream/62">{integration.description}</p>
                </Card3D>
              ))}
            </div>
          </div>
        </Container>
      </MotionSection>

      <MotionSection className="py-20 text-jisra-cream sm:py-24" withStagger>
        <Container className="space-y-12">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-jisra-green">
                Section — Tarifs
              </div>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Des plans simples pour structurer puis scaler</h2>
            </div>
            <MarketingLink href="/pricing" variant="secondary" className="gap-2 self-start">
              Voir le détail <ArrowRight className="h-4 w-4" />
            </MarketingLink>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            {plans.map((plan) => {
              const features = homePlanFeatures[plan.name] ?? []
              const isPro = plan.name === 'Pro'
              return (
                <Card3D
                  key={plan.id}
                  className={`rounded-[2rem] border p-7 ${
                    isPro
                      ? 'border-jisra-green/30 bg-jisra-green/10'
                      : 'border-white/10 bg-white/[0.03]'
                  }`}
                >
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-jisra-green">{plan.name}</p>
                  <p className="mt-4 text-3xl font-bold">
                    {plan.price === 0 ? 'Gratuit' : `${plan.price} DHS`}
                  </p>
                  <p className="mt-3 text-sm leading-7 text-jisra-cream/62">
                    {plan.name === 'Gratuit'
                      ? 'Pour découvrir jisra sans engagement.'
                      : plan.name === 'Pro'
                        ? 'Pour les marques qui veulent scaler avec des données fiables.'
                        : 'Pour les équipes multi-stores avec pilotage consolidé.'}
                  </p>
                  <ul className="mt-6 space-y-3 text-sm text-jisra-cream/75">
                    {features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-jisra-green" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </Card3D>
              )
            })}
          </div>
        </Container>
      </MotionSection>

      <MotionSection className="py-20 sm:py-24" withStagger>
        <Container className="space-y-12">
          <SectionHeading
            eyebrow="Témoignages"
            title="Des équipes qui veulent enfin une lecture business exploitable"
            description="Nous parlons à des marchands qui n’acceptent plus de piloter à l’approximation."
          />
          <TestimonialsCarousel items={testimonials} />
        </Container>
      </MotionSection>

      <MotionSection className="py-20 sm:py-24" withStagger>
        <Container className="space-y-12">
          <SectionHeading
            eyebrow="FAQ"
            title="Questions fréquentes"
            description="Les réponses clés avant de lancer votre mise en place."
          />
          <div className="grid gap-4 lg:grid-cols-2">
            {faqItems.map((item) => (
              <Card3D key={item.question} className="p-6">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-jisra-green/10">
                  <HelpCircle className="h-5 w-5 text-jisra-green" />
                </div>
                <h3 className="text-lg font-semibold text-jisra-cream">{item.question}</h3>
                <p className="mt-3 text-sm leading-7 text-jisra-cream/66">{item.answer}</p>
              </Card3D>
            ))}
          </div>
        </Container>
      </MotionSection>

      <MotionSection className="py-20 sm:py-24" withStagger>
        <Container>
          <div className="marketing-panel marketing-noise overflow-hidden px-6 py-10 text-jisra-cream sm:px-10 sm:py-12">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(31,169,113,0.22),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(198,139,60,0.18),transparent_24%)]" />
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl space-y-3">
                <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-jisra-green">
                  Section — Passer à l’action
                </div>
                <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                  Arrêtez de piloter votre croissance à l’aveugle.
                </h2>
                <p className="text-base leading-8 text-jisra-cream/65">
                  Branchez vos stores, visualisez votre profit réel et gagnez du temps sur les opérations les plus coûteuses.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <MarketingLink href="/login?signup=1">Créer un compte</MarketingLink>
                <MarketingLink href="/contact" variant="ghost">
                  Parler à l’équipe
                </MarketingLink>
              </div>
            </div>
          </div>
        </Container>
      </MotionSection>
    </>
  )
}