'use client'

import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MarketingLink } from '@/components/marketing/shared/marketing-link'
import type { CatalogPrice } from '@/lib/billing/catalog'
import { formatMad, planFeatures, priceDescription, subscribePath } from '@/lib/billing/presentation'

type PricingCardProps = {
  plan: CatalogPrice
  featured?: boolean
  index: number
  appearance?: 'marketing' | 'app'
  current?: boolean
}

export function PricingCard({ plan, featured, index, appearance = 'marketing', current }: PricingCardProps) {
  const features = planFeatures(plan)

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className={cn(
        'relative rounded-[2rem] border p-6 sm:p-8 transition-all duration-300',
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
        {plan.name}{current ? ' — Votre offre' : ''}
      </p>

      <div className="mt-4 flex items-baseline gap-1">
        <span className={cn("text-4xl font-bold", appearance === "app" ? "text-foreground" : "text-jisra-cream")}>
          {formatMad(plan.monthly_equivalent_minor)}
        </span>
        {plan.requires_payment && (
          <span className="text-xs uppercase tracking-[0.18em] text-jisra-cream/38">
            / mois
          </span>
        )}
      </div>

      <p className={cn("mt-3 text-sm", appearance === "app" ? "text-muted-foreground" : "text-jisra-cream/60")}>{plan.requires_payment && plan.billing_period === 'yearly' ? 'Équivalent mensuel. ' : ''}{priceDescription(plan)}</p>

      <ul className="mt-6 space-y-3">
        {features.map((feature) => (
          <li key={feature} className={cn("flex items-start gap-3 text-sm", appearance === "app" ? "text-muted-foreground" : "text-jisra-cream/75")}>
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-jisra-green" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <MarketingLink href={subscribePath(plan)} className="mt-8 w-full">
        {!plan.requires_payment ? 'Commencer gratuitement' : current ? 'Renouveler' : appearance === 'app' ? 'Changer d’offre' : 'Choisir ce forfait'}
      </MarketingLink>
    </motion.div>
  )
}
