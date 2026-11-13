import 'server-only'
import { readPublicPlanCatalog } from '@/lib/billing/catalog.server'
import { PUBLIC_ASSISTANT_ROUTES } from './public-routes'
import { featurePages, integrations, modules } from '@/lib/marketing/site'
import { pricingFaqItems } from '@/lib/marketing/faq'
import {
  buildCommercialSnapshot,
  buildSystemPrompt,
  sanitizeReply,
  type PublicKnowledge,
  type PublicLocale,
} from './knowledge-core'

export type { PublicKnowledge, PublicLocale }
export { buildSystemPrompt, sanitizeReply }

/**
 * Base de connaissances publique, vérifiée, sans donnée de boutique.
 * Le catalogue est relu à chaque requête : aucun prix mis en cache ni figé.
 * S’il est indisponible, l’instantané l’indique et le prompt interdit de citer
 * un montant.
 */
export async function publicKnowledge(): Promise<PublicKnowledge> {
  let catalog: Awaited<ReturnType<typeof readPublicPlanCatalog>> | null = null
  try {
    catalog = await readPublicPlanCatalog()
  } catch {
    // Catalogue local invalide ou Supabase indisponible : aucun montant cité.
    catalog = null
  }
  const features = featurePages
    .filter((feature) => Boolean(feature.description))
    .map((feature) => ({ title: feature.title, description: feature.description }))
  const snapshot = buildCommercialSnapshot({
    catalog,
    features,
    modules,
    integrations,
    faq: pricingFaqItems,
  })
  return {
    ...snapshot,
    navigation: PUBLIC_ASSISTANT_ROUTES.map(({ href, label }) => ({ href, label })),
  }
}

