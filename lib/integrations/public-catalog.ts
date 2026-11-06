import { createClient } from '@supabase/supabase-js'

export type PublicIntegrationProvider = {
  id: string
  slug: string
  name: string
  description: string
  logoUrl: string | null
  category: string | null
}

type ProviderRow = {
  id: string
  slug: string
  name: string
  description: string | null
  logo_url: string | null
  category: string | null
}

/**
 * Catalogue public des intégrations affiché sur la page marketing
 * `/catalogue-integrations`.
 *
 * Lecture anonyme volontaire (client sans cookies, donc cachable) : la policy
 * RLS `integration_providers_anon_read_active` n'expose que les fournisseurs
 * actifs, et la table ne contient aucun identifiant de connexion.
 */
export async function getPublicIntegrationProviders(): Promise<PublicIntegrationProvider[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return []

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase
    .from('integration_providers')
    .select('id, slug, name, description, logo_url, category')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) {
    console.error('Failed to load public integration providers:', error.message)
    return []
  }

  return ((data || []) as ProviderRow[]).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description || '',
    logoUrl: row.logo_url,
    category: row.category,
  }))
}
