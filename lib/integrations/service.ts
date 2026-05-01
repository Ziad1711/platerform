import { createClient } from '@/lib/supabase/client'

export type IntegrationProvider = 'youcan' | 'rapid-delivery' | 'facebook-ads'

export type IntegrationRecord = {
  id: string
  provider: string
  provider_id: string | null
  status: string
  store_domain: string | null
}

export type IntegrationProviderRecord = {
  id: string
  name: string
  slug: string
  description: string | null
  logo_url: string | null
  rating_avg: number
  total_reviews: number
}

export type IntegrationProviderMetricRecord = {
  provider_id: string
  connected_users_count: number
}

export type IntegrationMarketplaceItem = {
  id: string
  slug: string
  name: string
  description: string
  logoUrl: string | null
  ratingAvg: number
  totalReviews: number
  usersCount: number
  isConnected: boolean
  status: string
}

export async function getUserIntegrations() {
  const supabase = createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) throw userError
  if (!user) return []

  const { data, error } = await supabase
    .from('integrations')
    .select('id, provider, provider_id, status, store_domain')
    .eq('user_id', user.id)

  if (error) throw error
  return (data || []) as IntegrationRecord[]
}

export async function getIntegrationMarketplaceData() {
  const supabase = createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) throw userError
  if (!user) return [] as IntegrationMarketplaceItem[]

  const [{ data: providers, error: providersError }, { data: userIntegrations, error: userIntegrationsError }, { data: providerMetrics, error: providerMetricsError }] = await Promise.all([
    supabase
      .from('integration_providers')
      .select('id, name, slug, description, logo_url, rating_avg, total_reviews')
      .eq('is_active', true)
      .order('name', { ascending: true }),
    supabase
      .from('integrations')
      .select('id, provider, provider_id, status, store_domain')
      .eq('user_id', user.id),
    supabase
      .from('integration_provider_metrics')
      .select('provider_id, connected_users_count'),
  ])

  if (providersError) throw providersError
  if (userIntegrationsError) throw userIntegrationsError
  if (providerMetricsError) throw providerMetricsError

  const integrationsByProviderId = new Map(
    ((userIntegrations || []) as IntegrationRecord[])
      .filter((integration) => integration.provider_id)
      .map((integration) => [integration.provider_id as string, integration])
  )

  const integrationsByProviderSlug = new Map(
    ((userIntegrations || []) as IntegrationRecord[]).map((integration) => [integration.provider, integration])
  )

  const metricsByProviderId = new Map(
    ((providerMetrics || []) as IntegrationProviderMetricRecord[]).map((metric) => [metric.provider_id, metric.connected_users_count])
  )

  return ((providers || []) as IntegrationProviderRecord[]).map((provider) => {
    const userIntegration = integrationsByProviderId.get(provider.id) || integrationsByProviderSlug.get(provider.slug)

    return {
      id: provider.id,
      slug: provider.slug,
      name: provider.name,
      description: provider.description || '',
      logoUrl: provider.logo_url,
      ratingAvg: Number(provider.rating_avg || 0),
      totalReviews: Number(provider.total_reviews || 0),
      usersCount: Number(metricsByProviderId.get(provider.id) || 0),
      isConnected: userIntegration?.status === 'connected',
      status: userIntegration?.status || 'not_connected',
    } as IntegrationMarketplaceItem
  })
}

export async function getProviderIntegration(provider: IntegrationProvider) {
  const integrations = await getUserIntegrations()
  return integrations.find((item) => item.provider === provider) || null
}
