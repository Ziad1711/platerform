'use client'

import { useMemo, useState } from 'react'
import { HelpCircle, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { faqCategories, getFaqByCategory, getPopularFaqQuestions, searchFaq } from '@/lib/marketing/faq'
import { FaqAccordion } from './faq-accordion'

const ALL = 'all'

export function FaqExperience() {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<string>(ALL)
  const trimmed = query.trim()

  const categories = useMemo(() => [...faqCategories].sort((a, b) => a.order - b.order), [])
  const groups = useMemo(
    () => categories
      .map((category) => ({ category, questions: getFaqByCategory(category.id) }))
      .filter((group) => group.questions.length > 0),
    [categories],
  )
  const popular = useMemo(() => getPopularFaqQuestions(), [])
  const results = useMemo(() => (trimmed ? searchFaq(trimmed) : []), [trimmed])

  const visibleGroups = active === ALL ? groups : groups.filter((group) => group.category.id === active)
  const total = groups.reduce((sum, group) => sum + group.questions.length, 0)

  return (
    <div className="space-y-8">
      <div role="search" className="relative mx-auto max-w-2xl">
        <label htmlFor="faq-search" className="sr-only">Rechercher dans la FAQ</label>
        <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-jisra-cream/40" />
        <input
          id="faq-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher une question (paiement, livraison, stock…)"
          className="h-14 w-full rounded-2xl border border-white/15 bg-white/[0.04] pl-12 pr-12 text-sm text-jisra-cream placeholder:text-jisra-cream/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jisra-green"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Effacer la recherche"
            className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-jisra-cream/50 hover:bg-white/10 hover:text-jisra-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jisra-green"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <p aria-live="polite" className="sr-only">
        {trimmed ? `${results.length} question(s) trouvée(s).` : `${total} questions disponibles.`}
      </p>

      {trimmed ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold text-jisra-cream">
              {results.length > 0 ? `${results.length} résultat${results.length > 1 ? 's' : ''}` : 'Aucun résultat'}
              <span className="ml-2 text-sm font-normal text-jisra-cream/50">pour « {trimmed} »</span>
            </h2>
            <button type="button" onClick={() => setQuery('')} className="text-sm text-jisra-green hover:underline">
              Tout afficher
            </button>
          </div>
          {results.length > 0 ? (
            <FaqAccordion idPrefix="faq-search" items={results} />
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm leading-7 text-jisra-cream/68">
              Aucune question ne correspond à votre recherche. Vous pouvez proposer votre question plus bas : elle sera étudiée par l’équipe Jisra.
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[260px_1fr]">
          <nav aria-label="Catégories de la FAQ" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-jisra-green-light">Catégories</p>
            <div className="flex max-w-full gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
              <button
                type="button"
                aria-pressed={active === ALL}
                onClick={() => setActive(ALL)}
                className={cn('shrink-0 rounded-xl px-3 py-2 text-left text-sm transition', active === ALL ? 'bg-jisra-green/15 text-jisra-cream' : 'text-jisra-cream/60 hover:bg-white/5 hover:text-jisra-cream')}
              >
                Toutes les questions <span className="text-jisra-cream/40">({total})</span>
              </button>
              {groups.map((group) => (
                <button
                  key={group.category.id}
                  type="button"
                  aria-pressed={active === group.category.id}
                  onClick={() => setActive(group.category.id)}
                  className={cn('shrink-0 rounded-xl px-3 py-2 text-left text-sm transition', active === group.category.id ? 'bg-jisra-green/15 text-jisra-cream' : 'text-jisra-cream/60 hover:bg-white/5 hover:text-jisra-cream')}
                >
                  {group.category.label} <span className="text-jisra-cream/40">({group.questions.length})</span>
                </button>
              ))}
            </div>
          </nav>

          <div className="min-w-0 space-y-10">
            {active === ALL && popular.length > 0 ? (
              <section aria-labelledby="faq-popular">
                <h2 id="faq-popular" className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-jisra-cream/70">
                  <HelpCircle aria-hidden className="h-4 w-4 text-jisra-green" /> Questions populaires
                </h2>
                <div className="flex flex-wrap gap-2">
                  {popular.map((item) => (
                    <a
                      key={item.id}
                      href={`#${item.id}`}
                      className="inline-flex min-h-9 items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-sm text-jisra-cream/75 transition hover:border-jisra-green/40 hover:text-jisra-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jisra-green"
                    >
                      {item.question}
                    </a>
                  ))}
                </div>
              </section>
            ) : null}

            {visibleGroups.map((group) => (
              <section key={group.category.id} id={group.category.id} aria-labelledby={`cat-${group.category.id}`} className="scroll-mt-24">
                <h2 id={`cat-${group.category.id}`} className="text-xl font-semibold text-jisra-cream">{group.category.label}</h2>
                <p className="mt-1 text-sm text-jisra-cream/50">{group.category.description}</p>
                <FaqAccordion idPrefix={`faq-${group.category.id}`} items={group.questions} className="mt-4" />
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
