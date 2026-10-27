'use client'

/**
 * Accès React Query au lecteur KPI V5.
 *
 * - une seule clé de cache par (frontière d'identité, boutiques, période) ;
 * - révision : RPC minimale dédiée (`publish_counter` seul), toutes les 2 s
 *   quand l'onglet est visible ; un changement de révision invalide la lecture ;
 * - focus/reconnexion : comportement par défaut de React Query (revalidation) ;
 * - changement de boutique : la clé change, donc nouvelle lecture.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  dashboardKpiReaderKey,
  fetchDashboardKpiReader,
  fetchDashboardKpiRevisions,
  type KpiRevisionRow,
  type KpiReaderPayload,
} from './kpi-reader'
import type { DashboardPeriod } from '@/lib/utils'
import { DASHBOARD_ANALYTICS_STALE_MS } from './analytics-cache'
import {
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
  /**
   * Lecteur à interroger (`KPI_READER_RPC_V2` pour le coût de livraison
   * journalier). La sonde de révision n'utilise plus le lecteur : elle appelle
   * sa propre RPC minimale (`rpc_dashboard_kpi_revisions`).
   */
  rpc?: string
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
  rpc,
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
    () => ({ storeIds: sortedStoreIds, from, to, includeDirect, rpc }),
    [sortedStoreIds, from, to, includeDirect, rpc],
  )

  const main = useQuery<KpiReaderPayload>({
    queryKey: dashboardKpiReaderKey(boundary, input),
    enabled: enabled && Boolean(from) && Boolean(to),
    // Fraîcheur analytique explicite : une période déjà consultée n'est pas
    // relue dans la fenêtre (60 s), tout en restant invalidée par la révision
    // ou après une mutation réussie.
    staleTime: DASHBOARD_ANALYTICS_STALE_MS,
    // Une seule reprise : ne pas marteler le pool PostgREST sur une 5xx.
    retry: 1,
    // Pas de données de la boutique/mode précédent pendant un changement de clé.
    // Le signal annule réellement la requête réseau quand le filtre change.
    queryFn: ({ signal }) => fetchDashboardKpiReader(supabase, { ...input, signal }),
  })

  // Révision : RPC minimale dédiée (`publish_counter` seul). Aucune grille
  // journalière, aucun agrégat ni montant : le coût du polling ne dépend plus
  // de la période affichée. Clé DISTINCTE du lecteur : cette requête ne doit
  // jamais s'auto-invalider.
  const revision = useQuery<KpiRevisionRow[]>({
    queryKey: ['dashboard-kpi-revision', boundary, sortedStoreIds ?? 'all'],
    enabled: enabled && Boolean(pollMs) && visible,
    refetchInterval: pollMs || false,
    refetchOnWindowFocus: false,
    staleTime: 0,
    // Pas de reprises internes : le prochain tick normal réessaie la sonde
    // après une panne, sans modifier les retries du lecteur financier.
    retry: false,
    queryFn: ({ signal }) =>
      fetchDashboardKpiRevisions(supabase, { storeIds: sortedStoreIds, signal }),
  })

  const revisionKey = useMemo(
    () =>
      (revision.data ?? [])
        .map((row) => `${row.store_id}:${row.publish_counter}`)
        .sort()
        .join('|'),
    [revision.data],
  )

  // Invalidation SCOPÉE à la frontière d'identité courante (jamais une autre
  // boutique ni un autre compte) : seule la clé `dashboard-kpi-reader` de ce
  // `boundary` est relue. La première réception de révision ne rejoue pas la
  // lecture (données déjà fraîches) ; seuls les changements ultérieurs de
  // révision déclenchent une relecture.
  const previousRevisionKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (!revisionKey) return
    const previous = previousRevisionKeyRef.current
    previousRevisionKeyRef.current = revisionKey
    if (previous === null || previous === revisionKey) return
    void queryClient.invalidateQueries({ queryKey: ['dashboard-kpi-reader', boundary] })
  }, [revisionKey, boundary, queryClient])

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
