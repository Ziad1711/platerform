import 'server-only'
import localCatalog from './catalog.local.json'
import { createClient } from '@supabase/supabase-js'
import { assertQualificationIsolation } from '@/lib/env/qualification-guard'
import { publicCatalogSchema } from './catalog'

/** Lecture fraîche pour le récapitulatif ; aucun client administrateur. */
export async function readPublicPlanCatalog() {
  // Catalogue local de développement : aucune connexion Supabase.
  if (process.env.PUBLIC_CATALOG_LOCAL === 'enabled' && process.env.NODE_ENV !== 'production') {
    return publicCatalogSchema.parse(localCatalog.prices)
  }
  assertQualificationIsolation()
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, options) => fetch(url, { ...options, cache: 'no-store' }) },
  })
  const { data, error } = await client.rpc('rpc_public_plan_catalog')
  if (error) throw error
  return publicCatalogSchema.parse(data)
}