'use client'

import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { PublicIntegrationProvider } from '@/lib/integrations/public-catalog'
import { Container } from '@/components/marketing/shared/container'
import { Card3D } from '@/components/marketing/shared/card-3d'
import { MotionSection } from '@/components/marketing/shared/motion-section'
import { MarketingLink } from '@/components/marketing/shared/marketing-link'
import { IntegrationLogo } from '@/components/marketing/integrations/integration-logo'

const categoryGroups = [
  {
    key: 'ecommerce',
    label: 'Boutiques & e-commerce',
    description: 'Importez les commandes de vos boutiques dans jisra, sans ressaisie.',
  },
  {
    key: 'delivery',
    label: 'Livraison & transporteurs',
    description: 'Créez les colis, imprimez les documents et suivez les statuts transmis par le transporteur.',
  },
  {
    key: 'marketing',
    label: 'Publicité',
    description: 'Rattachez vos dépenses publicitaires aux produits et aux commandes.',
  },
  {
    key: 'api',
    label: 'API & sites personnalisés',
    description: 'Connectez un site maison grâce à une API simple à appeler.',
  },
]

type ProviderGroup = {
  key: string
  label: string
  description: string
  items: PublicIntegrationProvider[]
}

function buildGroups(providers: PublicIntegrationProvider[]): ProviderGroup[] {
  const groups: ProviderGroup[] = categoryGroups
    .map((group) => ({
      ...group,
      items: providers.filter((provider) => provider.category === group.key),
    }))
    .filter((group) => group.items.length > 0)

  const knownKeys = new Set(categoryGroups.map((group) => group.key))
  const others = providers.filter((provider) => !knownKeys.has(provider.category ?? ''))
  if (others.length > 0) {
    groups.push({
      key: 'autres',
      label: 'Autres intégrations',
      description: 'Intégrations activées sur votre compte.',
      items: others,
    })
  }

  return groups
}

/** Minuscules sans accents, pour une recherche tolérante à la saisie. */
function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function ProviderCard({ provider }: { provider: PublicIntegrationProvider }) {
  return (
    <Card3D className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white">
            <IntegrationLogo name={provider.name} logoUrl={provider.logoUrl} />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-jisra-cream">{provider.name}</h3>
            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-jisra-cream/42">Intégration</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-jisra-green/10 px-3 py-1 text-xs font-semibold text-jisra-green">
          Disponible
        </span>
      </div>
      <p className="mt-5 text-sm leading-7 text-jisra-cream/62">
        {provider.description || 'Intégration disponible dans jisra.'}
      </p>
    </Card3D>
  )
}

export function IntegrationsCatalog({ providers }: { providers: PublicIntegrationProvider[] }) {
  const [search, setSearch] = useState('')

  const groups = useMemo(() => buildGroups(providers), [providers])

  const filteredGroups = useMemo(() => {
    const term = normalize(search.trim())
    if (!term) return groups

    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (provider) =>
            normalize(provider.name).includes(term) ||
            normalize(provider.description).includes(term) ||
            normalize(group.label).includes(term)
        ),
      }))
      .filter((group) => group.items.length > 0)
  }, [groups, search])

  const resultCount = filteredGroups.reduce((total, group) => total + group.items.length, 0)
  const isSearching = search.trim().length > 0

  return (
    <>
      <MotionSection className="pb-0" withStagger>
        <Container className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-[24px] border border-white/10 bg-white/[0.03] px-5 py-4">
            <span className="rounded-full border border-jisra-green/20 bg-jisra-green/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-jisra-green-light">
              {providers.length} intégrations disponibles
            </span>
            <p className="text-sm text-jisra-cream/58">Liste synchronisée avec le catalogue produit de jisra.</p>
          </div>

          <div className="relative">
            <div className="pointer-events-none absolute -inset-px rounded-[22px] bg-gradient-to-r from-jisra-green/45 via-jisra-green/15 to-transparent opacity-70" />
            <div className="relative flex items-center gap-3 rounded-[20px] border border-jisra-green/25 bg-[#121916]/95 px-4 shadow-[0_18px_50px_rgba(31,169,113,0.16)] backdrop-blur-xl">
              <Search className="h-5 w-5 shrink-0 text-jisra-green" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Rechercher une intégration — YouCan, Ozone, Facebook Ads…"
                aria-label="Rechercher une intégration"
                className="h-14 w-full bg-transparent text-base text-jisra-cream placeholder:text-jisra-cream/40 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
              />
              {isSearching ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Effacer la recherche"
                  className="shrink-0 rounded-full p-2 text-jisra-cream/55 transition hover:bg-white/10 hover:text-jisra-cream"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          {isSearching ? (
            <p className="text-xs uppercase tracking-[0.18em] text-jisra-cream/45">
              {resultCount} résultat{resultCount > 1 ? 's' : ''}
            </p>
          ) : null}
        </Container>
      </MotionSection>

      {filteredGroups.length > 0 ? (
        filteredGroups.map((group, index) => (
          <MotionSection
            key={group.key}
            className={index === 0 ? 'pt-6 pb-7 sm:pt-8 sm:pb-9' : 'py-7 sm:py-9'}
            withStagger
          >
            <Container className="space-y-8">
              <div className="space-y-3">
                <h2 className="text-2xl font-bold tracking-[-0.03em] text-jisra-cream sm:text-3xl">
                  {group.label}
                </h2>
                <p className="max-w-3xl text-base leading-8 text-jisra-cream/62">{group.description}</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((provider) => (
                  <ProviderCard key={provider.id} provider={provider} />
                ))}
              </div>
            </Container>
          </MotionSection>
        ))
      ) : (
        <MotionSection className="py-14 sm:py-16">
          <Container>
            <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-8 text-center">
              <p className="text-lg font-semibold text-jisra-cream">
                {isSearching ? 'Aucune intégration ne correspond à cette recherche' : 'Catalogue en cours de mise à jour'}
              </p>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-jisra-cream/62">
                {isSearching
                  ? 'Essayez un autre nom d’outil ou de transporteur, ou contactez-nous pour vérifier une intégration.'
                  : 'Contactez-nous pour connaître les intégrations activables sur votre compte.'}
              </p>
              <div className="mt-6 flex justify-center">
                <MarketingLink href="/contact" variant="secondary">
                  Parler à l’équipe
                </MarketingLink>
              </div>
            </div>
          </Container>
        </MotionSection>
      )}
    </>
  )
}
