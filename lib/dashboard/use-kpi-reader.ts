'use client'

/**
 * Accès React Query au lecteur KPI V5.
 *
 * - une seule clé de cache par (frontière d'identité, boutiques, période) ;
 * - révision légère : appel d'un jour, `includeDirect=false`, toutes les 2 s
 *   quand l'onglet est visible ; un changement de révision invalide la lecture ;
 * - focus/reconnexion : comportement par défaut de React Query (revalidation) ;
 * - changement de boutique : la clé change, donc nouvelle lecture.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  dashboardKpiReaderKey,
  fetchDashboardKpiReader,
  type KpiReaderPayload,
} from './kpi-reader'
import type { DashboardPeriod } from '@/lib/utils'
import {
  BUSINESS_TIME_ZONE,
  businessRange,
  previousBusinessRange,
  type BusinessRange,
} from './business-time'

export const KPI_REVISION_POLL_MS = 2_000
/** « Toujours » borné : le lecteur refuse au-delà de 400 jours. */
export const KPI_READER_MAX_DAYS = 365

// API historique conservée pour les composants Dashboard.
export { businessRange, previousBusinessRange }
export type { BusinessRange }

export interface UseKpiReaderOptions {
  enabled: boolean
  supabase: SupabaseClient
  /** Frontière utilisateur/session : entre dans la clé de cache. */
  boundary: string
  /** `null` = toutes les boutiques autorisées (résolues en base). */
  storeIds: string[] | null
  from: string
  to: string
  includeDirect?: boolean
  pollMs?: number
}

export function useKpiReader({
  enabled,
  supabase,
  boundary,
  storeIds,
  from,
  to,
  includeDirect = true,
  pollMs = KPI_REVISION_POLL_MS,
}: UseKpiReaderOptions) {
  const queryClient = useQueryClient()
  const [visible, setVisible] = useState(true)
  const sortedStoreIds = useMemo(
    () => (storeIds ? [...storeIds].sort() : null),
    [storeIds],
  )

  useEffect(() => {
    const onChange = () => setVisible(!document.hidden)
    onChange()
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])

  const input = useMemo(
    () => ({ storeIds: sortedStoreIds, from, to, includeDirect }),
    [sortedStoreIds, from, to, includeDirect],
  )

  const main = useQuery<KpiReaderPayload>({
    queryKey: dashboardKpiReaderKey(boundary, input),
    enabled: enabled && Boolean(from) && Boolean(to),
    // Pas de données de la boutique/mode précédent pendant un changement de clé.
    // Le signal annule réellement la requête réseau quand le filtre change.
    queryFn: ({ signal }) => fetchDashboardKpiReader(supabase, { ...input, signal }),
  })

  // Révision : journée métier courante (Africa/Casablanca), jamais locale.
  const revisionRange = businessRange(
    'today',
    null,
    null,
    new Date(),
    BUSINESS_TIME_ZONE,
    KPI_READER_MAX_DAYS,
  )
  const revisionInput = useMemo(
    () => ({
      storeIds: sortedStoreIds,
      from: revisionRange.from,
      to: revisionRange.to,
      includeDirect: false,
    }),
    [sortedStoreIds, revisionRange.from, revisionRange.to],
  )

  // Révision : une seule journée, sans fallback direct → coût minimal.
  // Clé DISTINCTE du lecteur : cette requête ne doit jamais s'auto-invalider.
  const revision = useQuery<KpiReaderPayload>({
    queryKey: [
      'dashboard-kpi-revision',
      boundary,
      sortedStoreIds ?? 'all',
      revisionInput.from,
      revisionInput.includeDirect,
    ],
    enabled: enabled && Boolean(pollMs) && visible,
    refetchInterval: pollMs || false,
    refetchOnWindowFocus: false,
    staleTime: 0,
    queryFn: ({ signal }) =>
      fetchDashboardKpiReader(supabase, { ...revisionInput, signal }),
  })

  const revisionKey = useMemo(
    () =>
      (revision.data?.stores ?? [])
        .map((store) => `${store.store_id}:${store.revision}`)
        .sort()
        .join('|'),
    [revision.data],
  )

  useEffect(() => {
    if (!revisionKey) return
    void queryClient.invalidateQueries({ queryKey: ['dashboard-kpi-reader'] })
  }, [revisionKey, queryClient])

  return {
    data: main.data,
    isLoading: main.isLoading,
    isFetching: main.isFetching,
    isError: main.isError,
    error: main.error,
    refetch: main.refetch,
    revisionKey,
  }
}
