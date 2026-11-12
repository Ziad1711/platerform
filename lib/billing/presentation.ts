import type { CatalogPrice } from './catalog'

export type BillingPeriod = CatalogPrice['billing_period']

export function formatMad(minor: number) {
  return `${(minor / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} MAD`
}

export function subscribePath(price: CatalogPrice) {
  const query = new URLSearchParams({ plan: price.code, period: price.billing_period, price: price.price_id })
  return `/subscribe?${query.toString()}`
}

export function priceDescription(price: CatalogPrice) {
  if (!price.requires_payment) return 'Gratuit, sans paiement ni engagement annuel.'
  if (price.billing_period === 'yearly') {
    return `${formatMad(price.amount_minor)} payés en une fois pour ${price.duration_months} mois. Engagement de ${price.commitment_months} mois. Aucun prélèvement mensuel.`
  }
  return `${formatMad(price.amount_minor)} pour ${price.duration_months} mois. Sans prélèvement automatique.`
}

export function planFeatures(price: CatalogPrice) {
  const limit = (n: number) => n >= 999999 ? 'Illimité' : n.toLocaleString('fr-FR')
  return [
    `${limit(price.order_limit)} commandes / mois`,
    `${limit(price.ai_credits_monthly)} crédits IA / mois`,
    `${limit(price.stores_limit)} boutique(s)`,
    `${limit(price.delivery_integrations_limit)} intégrations livraison`,
    `${limit(price.confirmation_agents_limit)} agents de confirmation`,
  ]
}