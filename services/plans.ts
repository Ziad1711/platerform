import { publicCatalogSchema, type CatalogPrice } from '@/lib/billing/catalog'

/** Source commerciale unique, sans lecture de plans.price. */
export async function getPublicPlanCatalog(): Promise<CatalogPrice[]> {
  const response = await fetch('/api/billing/catalog', { cache: 'no-store' })
  if (!response.ok) throw new Error('Les offres sont temporairement indisponibles.')
  const payload: unknown = await response.json()
  if (!payload || typeof payload !== 'object' || !('prices' in payload)) {
    throw new Error('Catalogue indisponible')
  }
  return publicCatalogSchema.parse(payload.prices)
}
