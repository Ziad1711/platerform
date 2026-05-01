'use client'

import { motion } from 'framer-motion'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Plan } from '@/services/plans'

type PricingComparisonProps = {
  plans: Plan[]
}

const comparisonRows = [
  { label: 'Commandes / mois', key: 'order_limit', format: (v: number) => v >= 999999 ? 'Illimité' : `Jusqu'à ${v.toLocaleString('fr-FR')}` },
  { label: 'Crédits IA / mois', key: 'ai_credits_monthly', format: (v: number) => v >= 999999 ? 'Illimité' : `${v.toLocaleString('fr-FR')}` },
  { label: 'Stores', key: 'stores_limit', format: (v: number) => v >= 999999 ? 'Illimité' : `${v}` },
  { label: 'Intégrations livraison', key: 'delivery_integrations_limit', format: (v: number) => v >= 999999 ? 'Illimité' : `${v}` },
  { label: 'Agents de confirmation', key: 'confirmation_agents_limit', format: (v: number) => v >= 999999 ? 'Illimité' : `${v}` },
  { label: 'Automatisation Facebook Ads', key: 'ads_automation_enabled', format: (v: boolean) => v ? <Check className="h-4 w-4 text-jisra-green" /> : <X className="h-4 w-4 text-red-400" /> },
  { label: 'Accès API', key: 'api_access_enabled', format: (v: boolean) => v ? <Check className="h-4 w-4 text-jisra-green" /> : <X className="h-4 w-4 text-red-400" /> },
]

export function PricingComparison({ plans }: PricingComparisonProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.4 }}
      className="overflow-x-auto"
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10">
            <th className="py-4 pr-6 text-left text-xs font-semibold uppercase tracking-[0.18em] text-jisra-cream/50">
              Fonctionnalité
            </th>
            {plans.map((plan) => (
              <th
                key={plan.id}
                className={cn(
                  'py-4 px-4 text-center text-sm font-semibold',
                  plan.name === 'Pro' ? 'text-jisra-green' : 'text-jisra-cream'
                )}
              >
                {plan.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparisonRows.map((row, i) => (
            <tr key={row.key} className={cn('border-b border-white/5', i % 2 === 0 && 'bg-white/[0.02]')}>
              <td className="py-3 pr-6 text-jisra-cream/65">{row.label}</td>
              {plans.map((plan) => (
                <td key={plan.id} className="py-3 px-4 text-center text-jisra-cream/75">
                  {row.format((plan as Record<string, unknown>)[row.key] as never)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </motion.div>
  )
}
