'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'
import { Crown, Eye, Gauge, PhoneCall, Shuffle, UserCheck } from 'lucide-react'
import { Container } from '@/components/marketing/shared/container'
import { SectionHeading } from '@/components/marketing/shared/section-heading'
import { MarketingLink } from '@/components/marketing/shared/marketing-link'
import { MotionSection } from '@/components/marketing/shared/motion-section'
import { fadeUp } from '@/lib/marketing/motion'
import { formatCurrency, formatNumber } from '@/lib/utils'

const capabilities = [
  {
    icon: UserCheck,
    title: 'Gestion des agents',
    description: 'Fiches agents créées depuis votre équipe. Commissions réglées au même endroit.',
  },
  {
    icon: Shuffle,
    title: 'Attribution des commandes',
    description: 'Répartition automatique vers l’agent actif le moins chargé.',
  },
  {
    icon: Gauge,
    title: 'Performance individuelle',
    description: 'Commandes, confirmations, livraisons, taux et commissions par agent.',
  },
  {
    icon: Eye,
    title: 'Confidentialité des commandes',
    description: 'Chaque agent ne voit que ses commandes. Les administrateurs gardent la vue complète.',
  },
]

/** Exemple d’écran : montants et volumes fictifs, commission 10 MAD par commande confirmée. */
const COMMISSION_PER_CONFIRMED = 10
const agents = [
  { name: 'Salma B.', orders: 186, confirmed: 158 },
  { name: 'Youssef E.', orders: 172, confirmed: 131 },
  { name: 'Nadia K.', orders: 164, confirmed: 139 },
  { name: 'Hamza R.', orders: 155, confirmed: 96 },
  { name: 'Imane T.', orders: 149, confirmed: 118 },
].map((agent) => ({
  ...agent,
  rate: agent.confirmed / agent.orders,
  commission: agent.confirmed * COMMISSION_PER_CONFIRMED,
}))

const totals = agents.reduce(
  (accumulator, agent) => ({
    orders: accumulator.orders + agent.orders,
    confirmed: accumulator.confirmed + agent.confirmed,
    commission: accumulator.commission + agent.commission,
  }),
  { orders: 0, confirmed: 0, commission: 0 }
)
const globalRate = totals.confirmed / totals.orders
const bestAgent = agents.reduce((best, agent) => (agent.rate > best.rate ? agent : best), agents[0])

function percent(value: number) {
  return `${(value * 100).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
}

const summary = [
  { label: 'Commandes vendues', value: formatNumber(totals.orders) },
  { label: 'Taux de confirmation', value: percent(globalRate) },
  { label: 'Commissions', value: formatCurrency(totals.commission, 'MAD') },
]


export function ConfirmationAgentsSection() {
  return (
    <MotionSection id="confirmation" className="py-20 sm:py-28" withStagger>
      <Container className="space-y-10">
        <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div className="min-w-0 space-y-7">
            <Image
              src="/marketing/agconfirmation.webp"
              alt="Gestion des agents de confirmation Jisra"
              width={1230}
              height={821}
              className="h-auto w-full rounded-2xl"
            />
            <SectionHeading
              eyebrow="Section — Confirmation des commandes"
              title="Organisez vos agents de confirmation, sans confusion."
              description="Chaque commande arrive dans une file claire, chaque agent voit son périmètre, et la performance se mesure commande par commande."
              align="left"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              {capabilities.map((capability) => (
                <motion.article key={capability.title} variants={fadeUp} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-jisra-green/10">
                      <capability.icon aria-hidden className="h-4 w-4 text-jisra-green" />
                    </span>
                    <h3 className="min-w-0 text-base font-semibold leading-6 text-jisra-cream">{capability.title}</h3>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-jisra-cream/65">{capability.description}</p>
                </motion.article>
              ))}
            </div>
          </div>

          <motion.div variants={fadeUp} className="relative min-w-0">
            <div className="marketing-panel marketing-noise min-w-0 overflow-hidden p-0">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-black/20 px-5 py-4">
                <div className="flex items-center gap-2">
                  <PhoneCall aria-hidden className="h-4 w-4 text-jisra-green" />
                  <span className="text-[11px] uppercase tracking-[0.2em] text-jisra-green-light">Performance des agents</span>
                </div>
                <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-jisra-cream/50">Ce mois</span>
              </div>

              <dl className="grid grid-cols-3 divide-x divide-white/10 border-b border-white/10">
                {summary.map((item) => (
                  <div key={item.label} className="min-w-0 px-3 py-3 sm:px-5 sm:py-4">
                    <dt className="text-[9px] uppercase leading-4 tracking-[0.1em] text-jisra-cream/50 sm:text-[10px] sm:tracking-[0.16em]">{item.label}</dt>
                    <dd className="mt-1 whitespace-nowrap text-[15px] font-semibold leading-tight text-jisra-cream sm:text-xl">{item.value}</dd>
                  </div>
                ))}
              </dl>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[352px] text-left text-[11px] sm:text-xs">
                  <thead className="text-jisra-cream/50">
                    <tr className="border-b border-white/10">
                      <th scope="col" className="px-3 py-3 font-medium sm:px-5">Agent</th>
                      <th scope="col" className="hidden px-2 py-3 text-right font-medium sm:table-cell sm:px-3">Commandes</th>
                      <th scope="col" className="hidden px-2 py-3 text-right font-medium sm:table-cell sm:px-3">Confirmées</th>
                      <th scope="col" className="px-2 py-3 text-right font-medium sm:px-3">Taux</th>
                      <th scope="col" className="px-3 py-3 text-right font-medium sm:px-5">Commissions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((agent) => {
                      const weak = agent.rate < 0.7
                      return (
                        <tr key={agent.name} className={weak ? 'border-b border-amber-400/20 bg-amber-400/[0.07] last:border-0' : 'border-b border-white/5 last:border-0'}>
                          <td className="px-3 py-3 sm:px-5">
                            <span className="flex items-center gap-2 text-jisra-cream">
                              <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-jisra-green/15 text-[10px] font-semibold text-jisra-green">
                                {agent.name.slice(0, 1)}
                              </span>
                              <span className="min-w-0">
                                <span className="flex items-center gap-1.5">
                                  <span className="truncate">{agent.name}</span>
                                  {agent.name === bestAgent.name ? (
                                    <Crown role="img" aria-label="Meilleur taux de confirmation" className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                                  ) : null}
                                </span>
                                <span className="mt-0.5 block text-[10px] leading-4 text-jisra-cream/45 sm:hidden">
                                  {formatNumber(agent.orders)} cmd. · {formatNumber(agent.confirmed)} conf.
                                </span>
                              </span>
                            </span>
                          </td>
                          <td className="hidden px-2 py-3 text-right text-jisra-cream/75 sm:table-cell sm:px-3">{formatNumber(agent.orders)}</td>
                          <td className="hidden px-2 py-3 text-right text-jisra-cream/75 sm:table-cell sm:px-3">{formatNumber(agent.confirmed)}</td>
                          <td className={`px-2 py-3 text-right sm:px-3 ${weak ? 'font-medium text-amber-300' : 'text-jisra-cream/75'}`}>{percent(agent.rate)}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-right font-medium text-jisra-green sm:px-5">{formatCurrency(agent.commission, 'MAD')}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <p className="border-t border-white/10 bg-black/10 px-5 py-3 text-[11px] leading-5 text-jisra-cream/45">
                Aperçu de l’écran « Performance des agents ». Données d’exemple, commission de 10 MAD par commande confirmée ; les totaux reprennent la somme des lignes. Couronne : meilleur taux. Ligne surlignée : taux inférieur à 70 %.
              </p>
            </div>
            <p className="mt-4 text-[11px] leading-5 text-jisra-cream/45">
              À développer ensuite : réaffectation manuelle d’une commande, réglage du plafond de charge et de la pondération par agent depuis l’interface, consolidation multi-boutiques.
            </p>
          </motion.div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <MarketingLink href="/signup" variant="primarySolid">
            Tester la confirmation
          </MarketingLink>
        </div>
      </Container>
    </MotionSection>
  )
}
