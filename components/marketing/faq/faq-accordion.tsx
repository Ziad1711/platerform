import Link from 'next/link'
import { ChevronDown, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export type FaqAccordionItem = {
  id: string
  question: string
  answer: string
  links?: { href: string; label: string }[]
}

type FaqAccordionProps = {
  items: FaqAccordionItem[]
  /** Préfixe d'identifiants pour éviter les collisions entre plusieurs accordéons. */
  idPrefix?: string
  className?: string
}

/**
 * Accordéon FAQ accessible sans JavaScript : `<details>/<summary>` gère
 * nativement le clavier et l'état ouvert/fermé, et le contenu reste dans le DOM
 * (donc indexable). Aucun état client, aucune dépendance d'animation.
 */
export function FaqAccordion({ items, idPrefix = 'faq', className }: FaqAccordionProps) {
  return (
    <div className={cn('space-y-3', className)}>
      {items.map((item) => (
        <details
          key={item.id}
          id={item.id}
          className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] open:border-white/20"
        >
          <summary
            id={`${idPrefix}-summary-${item.id}`}
            className="flex cursor-pointer list-none items-center gap-4 p-5 text-left transition-colors hover:bg-white/[0.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jisra-green [&::-webkit-details-marker]:hidden"
          >
            <HelpCircle aria-hidden className="h-5 w-5 shrink-0 text-jisra-green/60" />
            <h3 className="flex-1 text-sm font-semibold text-jisra-cream">{item.question}</h3>
            <ChevronDown
              aria-hidden
              className="h-4 w-4 shrink-0 text-jisra-cream/40 transition-transform duration-200 group-open:rotate-180"
            />
          </summary>
          <div className="border-t border-white/5 px-5 py-4">
            <p className="text-sm leading-7 text-jisra-cream/68">{item.answer}</p>
            {item.links && item.links.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {item.links.map((link) => (
                  <Link
                    key={`${item.id}-${link.href}`}
                    href={link.href}
                    className="inline-flex min-h-9 items-center rounded-full border border-jisra-green/40 px-3 py-1 text-xs font-medium text-jisra-green transition hover:bg-jisra-green/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jisra-cream"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </details>
      ))}
    </div>
  )
}
