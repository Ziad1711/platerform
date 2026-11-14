import { FaqAccordion } from '@/components/marketing/faq/faq-accordion'
import { pricingFaqItems } from '@/lib/marketing/faq'

/**
 * FAQ de la page Tarifs. Le contenu provient de la source unique
 * `lib/marketing/faq.ts` et l'affichage utilise l'accordéon accessible partagé.
 */
export function PricingFAQ() {
  const items = pricingFaqItems.map((item, index) => ({
    id: `pricing-${index}`,
    question: item.question,
    answer: item.answer,
  }))
  return <FaqAccordion items={items} idPrefix="pricing" className="mx-auto max-w-3xl" />
}
