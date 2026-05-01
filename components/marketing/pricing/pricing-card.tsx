'use client'

import { motion } from 'framer-motion'
import { Check, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MarketingLink } from '@/components/marketing/shared/marketing-link'
import type { Plan } from '@/services/plans'

type PricingCardProps = {
  plan: Plan
  featured?: boolean
  index: number
}

const planFeatures: Record<string, string[]> = {
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
    '3 agents de confirmation',
  ],
  Ultimate: [
    'Commandes illimitées',
    '100 000 crédits IA / mois',
    'Stores illimités',
    'Tout le plan Pro',
    'Équipe & rôles',
    'Support prioritaire',
    'Intégrations avancées',
    'API access',
  ],
}

export function PricingCard({ plan, featured, index }: PricingCardProps) {
  const features = planFeatures[plan.name] ?? []

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className={cn(
        'relative rounded-[2rem] border p-8 transition-all duration-300',
        featured
          ? 'border-jisra-green/30 bg-jisra-green/10 shadow-xl shadow-jisra-green/10 hover:shadow-jisra-green/20'
          : 'border-white/10 bg-white/[0.03] hover:border-white/20'
      )}
    >
      {featured && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-block rounded-full bg-jisra-green px-4 py-1 text-xs font-semibold uppercase tracking-wider text-white">
            Recommandé
          </span>
        </div>
      )}

      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-jisra-green">
        {plan.name}
      </p>

      <div className="mt-4 flex items-baseline gap-1">
        <span className="text-4xl font-bold text-jisra-cream">
          {plan.price === 0 ? 'Gratuit' : `${plan.price} DHS`}
        </span>
        {plan.price > 0 && (
          <span className="text-xs uppercase tracking-[0.18em] text-jisra-cream/38">
            / mois
          </span>
        )}
      </div>

      <ul className="mt-6 space-y-3">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-3 text-sm text-jisra-cream/75">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-jisra-green" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <MarketingLink
        href={plan.price === 0 ? '/auth/register' : `/auth/register?plan=${plan.name.toLowerCase()}`}
        className="mt-8 w-full"
      >
        {plan.price === 0 ? 'Commencer gratuitement' : 'Choisir ce plan'}
      </MarketingLink>
    </motion.div>
  )
}
