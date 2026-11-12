'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPublicPlanCatalog } from '@/services/plans'
import type { BillingPeriod } from '@/lib/billing/presentation'
import { PricingToggle } from '@/components/marketing/shared/pricing-toggle'
import { PricingCard } from './pricing-card'
import { PricingTunnelEvents } from './pricing-tunnel-events'

export const publicCatalogQuery = {
  queryKey: ['public-plan-catalog'],
  queryFn: getPublicPlanCatalog,
  staleTime: 30_000,
}

/** Une lecture mutualisée, aucun polling ni tarif de secours. */
export function CatalogOffers({ currentPlanName, appearance = 'marketing' }: {
  currentPlanName?: string
  appearance?: 'marketing' | 'app'
}) {
  const [billing, setBilling] = useState<BillingPeriod>('monthly')
  const { data = [], isPending, isError, refetch } = useQuery(publicCatalogQuery)
  const plans = data.filter((price) => price.billing_period === billing)
  return (
    <div className="space-y-6">
      <PricingTunnelEvents period={billing} />
      <div className="flex justify-center"><PricingToggle value={billing} onChange={setBilling} appearance={appearance} /></div>
      {isPending ? <p role="status">Chargement des offres…</p> : isError || plans.length === 0 ? (
        <div role="status" className="rounded-xl border p-5">
          <p>Les offres sont temporairement indisponibles.</p>
          <button type="button" className="mt-3 min-h-11 rounded-lg border px-4 underline" onClick={() => void refetch()}>Réessayer</button>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {plans.map((price, index) => <PricingCard key={price.price_id} plan={price} index={index}
            featured={price.code === 'pro'} appearance={appearance} current={price.name === currentPlanName} />)}
        </div>
      )}
    </div>
  )
}