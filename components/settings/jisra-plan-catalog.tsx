'use client'

import { Check, MessageCircle } from 'lucide-react'
import { formatCount, formatLimit, formatPrice, isUnlimited } from '@/components/settings/jisra-usage-progress'

/**
 * Comparatif incitatif des offres Jisra (catalogue `public.plans`).
 *
 * L'offre appliquée est mise en évidence, seules les offres supérieures
 * proposent une demande de passage via WhatsApp. Aucune modification d'offre
 * n'est faite depuis l'interface : la demande est transmise à l'équipe Jisra.
 */

export type CatalogPlan = {
  id: string
  name: string
  price: number | string | null
  order_limit?: number | null
  ai_credits_monthly?: number | null
  stores_limit?: number | null
}

type PlanCatalogProps = {
  plans: CatalogPlan[]
  currentPlanName: string
  /** Numéro WhatsApp Jisra (`''` = canal non configuré : CTA désactivé). */
  whatsappNumber: string
  /** Consommation du mois, reprise dans le message prérempli. */
  usageSummary: string
}

function storesLabel(limit?: number | null) {
  if (isUnlimited(limit)) return 'Stores illimités'
  const value = Number(limit ?? 0)
  return `${formatCount(value)} store${value > 1 ? 's' : ''}`
}

/** Gains chiffrés d'une offre supérieure par rapport à l'offre appliquée. */
function planGains(plan: CatalogPlan, current: CatalogPlan | null) {
  if (!current) return [] as string[]

  const gains: string[] = []
  const addGain = (label: string, planLimit?: number | null, currentLimit?: number | null) => {
    if (planLimit === null || planLimit === undefined) return
    if (planLimit === currentLimit || isUnlimited(currentLimit)) return

    if (isUnlimited(planLimit)) {
      gains.push(label === 'commandes' ? 'Commandes illimitées' : `${label === 'crédits IA' ? 'Crédits IA' : 'Stores'} illimités`)
      return
    }

    const diff = Number(planLimit) - Number(currentLimit ?? 0)
    if (diff > 0) gains.push(`+${formatCount(diff)} ${label} / mois`)
  }

  addGain('commandes', plan.order_limit, current.order_limit)
  addGain('crédits IA', plan.ai_credits_monthly, current.ai_credits_monthly)
  addGain('stores', plan.stores_limit, current.stores_limit)

  return gains
}


export default function PlanCatalog({ plans, currentPlanName, whatsappNumber, usageSummary }: PlanCatalogProps) {
  if (plans.length === 0) return null

  const current = plans.find((plan) => plan.name === currentPlanName) || null
  const currentPrice = Number(current?.price ?? 0)
  const upgrades = plans.filter((plan) => Number(plan.price ?? 0) > currentPrice)
  const nextUpgradeId = upgrades[0]?.id ?? null
  const onTopOffer = upgrades.length === 0

  return (
    <div className="space-y-3 border-t pt-5">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-foreground">Comparatif des offres</h3>
        <p className="text-xs text-muted-foreground">
          {onTopOffer
            ? "Vous êtes sur l'offre la plus complète du catalogue : commandes et stores sans limite."
            : `Votre offre ${currentPlanName} reste active sans engagement. Le passage à une offre supérieure est traité par l'équipe Jisra.`}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = current?.id === plan.id
          const isUpgrade = upgrades.some((item) => item.id === plan.id)
          const gains = isUpgrade ? planGains(plan, current) : []
          const price = formatPrice(plan.price)
          const message = encodeURIComponent(
            `Bonjour Jisra, je souhaite passer à l'offre ${plan.name} (${price} MAD / mois). ` +
              `Offre actuelle : ${currentPlanName}. ${usageSummary}`
          )
          const whatsappUrl = whatsappNumber ? `https://wa.me/${whatsappNumber}?text=${message}` : null
          const cardClass = isCurrent
            ? 'rounded-xl border border-primary/40 bg-primary/5 p-3 shadow-sm ring-1 ring-primary/20'
            : 'rounded-xl border bg-card p-3'
          const ctaClass = 'mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium'

          return (
            <div key={plan.id} className={cardClass}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-foreground">{plan.name}</p>
                {isCurrent ? (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    Votre offre
                  </span>
                ) : null}
                {plan.id === nextUpgradeId ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                    Recommandée
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-foreground">
                {price} <span className="text-xs text-muted-foreground">MAD / mois</span>
              </p>

              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                <li className="flex items-start gap-1.5">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>{formatLimit(plan.order_limit)} commandes / mois</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>{formatLimit(plan.ai_credits_monthly)} crédits IA / mois</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>{storesLabel(plan.stores_limit)}</span>
                </li>
              </ul>

              {gains.length > 0 ? (
                <ul className="mt-2 space-y-0.5 text-xs text-emerald-700">
                  {gains.map((gain) => (
                    <li key={gain}>
                      {gain} par rapport à {currentPlanName}
                    </li>
                  ))}
                </ul>
              ) : null}

              {isUpgrade && whatsappUrl ? (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${ctaClass} bg-primary text-primary-foreground transition hover:bg-primary/90`}
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  Demander l&apos;offre {plan.name}
                </a>
              ) : null}

              {isUpgrade && !whatsappUrl ? (
                <button
                  type="button"
                  disabled
                  title="Contact WhatsApp Jisra non configuré."
                  className={`${ctaClass} cursor-not-allowed bg-muted text-muted-foreground`}
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  Demander l&apos;offre {plan.name}
                </button>
              ) : null}

              {!isUpgrade && !isCurrent ? (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Offre inférieure à celle appliquée sur votre compte.
                </p>
              ) : null}
            </div>
          )
        })}
      </div>

      {!whatsappNumber ? (
        <p className="text-xs text-muted-foreground">
          Les demandes de changement d&apos;offre sont temporairement indisponibles : contact WhatsApp Jisra non
          configuré.
        </p>
      ) : null}
    </div>
  )
}
