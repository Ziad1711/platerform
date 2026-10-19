/**
 * Autorisation serveur du rollout KPI V5.
 *
 * Le mode effectif (legacy / shadow / v5) est décidé par la configuration
 * opérationnelle Supabase, jamais par cette variable seule. Ce verrou empêche
 * simplement un déploiement non autorisé d'utiliser le lecteur V5.
 *
 * - `KPI_READER_V5=1` est obligatoire ;
 * - Production exige un acquittement explicite contenant exactement son ref ;
 * - tout projet inconnu, URL invalide ou acquittement absent => legacy.
 */

const PRODUCTION_PROJECT_REF = 'attvfeoqgbxsnnsllatt'
const TEST_PROJECT_REF = 'goqedvcdmgtejtyrawsp'

export type KpiReaderMode = 'legacy' | 'shadow' | 'v5'
/** Alias historique conservé pour les composants existants. */
export type KpiReaderV5Source = 'legacy' | 'v5'

export function supabaseProjectRef(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!raw) return null
  try {
    const host = new URL(raw).hostname.toLowerCase()
    const match = /^([a-z0-9-]+)\.supabase\.co$/.exec(host)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

export function isProductionSupabase(): boolean {
  return supabaseProjectRef() === PRODUCTION_PROJECT_REF
}

/**
 * `true` uniquement si le rollout est autorisé côté serveur. Le mode reste
 * `legacy` par défaut ; la configuration en base peut ensuite le réduire.
 */
export function kpiReaderV5Enabled(): boolean {
  if (process.env.KPI_READER_V5 !== '1') return false
  const ref = supabaseProjectRef()
  if (!ref) return false
  if (ref === PRODUCTION_PROJECT_REF) {
    return process.env.KPI_READER_V5_PRODUCTION_ACK === PRODUCTION_PROJECT_REF
  }
  return ref === TEST_PROJECT_REF
}

/** Rendu serveur initial toujours sûr ; le contrôleur client décide ensuite. */
export function kpiReaderV5Source(): KpiReaderV5Source {
  return 'legacy'
}

export function kpiReaderServerMode(): KpiReaderMode {
  return 'legacy'
}
