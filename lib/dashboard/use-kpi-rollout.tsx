'use client'

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { BUSINESS_TIME_ZONE, businessRange } from './business-time'
import type { KpiReaderMode } from './kpi-reader-flag'
import {
  KPI_ROLLOUT_POLL_MS,
  KPI_ROLLOUT_SHADOW_STALE_MS,
  fetchKpiRollout,
  fetchKpiShadowCheck,
  acceptsRolloutEntry,
  isKpiRolloutFresh,
  reportKpiRolloutEvent,
  resolveKpiRolloutMode,
} from './rollout'

export interface KpiRolloutContextValue {
  enabled: boolean
  mode: KpiReaderMode
  requestedMode: KpiReaderMode
  configVersion: string
  shadowSamplePct: number
  killSwitch: boolean
  stale: boolean
  degraded: boolean
  /** Au moins une tentative de résolution terminée, ou rollout désactivé. */
  resolved: boolean
  currentStoreId: string | null
  storeIds: string[]
  /** Empreinte boutique:rôle ; invalide les caches lors d'un changement d'accès. */
  accessFingerprint: string
}

const DEFAULT_CONTEXT: KpiRolloutContextValue = {
  enabled: false,
  mode: 'legacy',
  requestedMode: 'legacy',
  configVersion: '0',
  shadowSamplePct: 0,
  killSwitch: true,
  stale: false,
  degraded: false,
  resolved: true,
  currentStoreId: null,
  storeIds: [],
  accessFingerprint: '',
}

const KpiRolloutContext = createContext<KpiRolloutContextValue>(DEFAULT_CONTEXT)

const CACHE_PREFIXES = [
  'dashboard-kpi-reader',
  'dashboard-kpi-revision',
  'dashboard-kpis',
  'dashboard-business-trends',
  'dashboard-ads-cost-chart',
  'dashboard-v5-waiting-pickup',
  'dashboard-kpi-shadow-check',
]

export function KpiRolloutProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}) {
  const { currentStoreId, accessibleStores, accessibleStoreIds, isStoresLoading, userId } = useStore()
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()
  const boundary = userId ?? 'anonymous'

  const storeIds = useMemo(() => {
    const ids = currentStoreId ? [currentStoreId] : accessibleStoreIds
    return Array.from(new Set(ids)).sort()
  }, [currentStoreId, accessibleStoreIds])

  const accessFingerprint = useMemo(
    () =>
      accessibleStores
        .map((store) => `${store.id}:${store.role ?? 'none'}`)
        .sort()
        .join('|'),
    [accessibleStores],
  )

  const canPoll = enabled && !isStoresLoading && storeIds.length > 0
  const requestSeqRef = useRef(0)
  const minAcceptedSeqRef = useRef(0)
  const previousRawModeRef = useRef<KpiReaderMode>('legacy')
  const rollout = useQuery({
    queryKey: ['dashboard-kpi-rollout', boundary, storeIds, accessFingerprint],
    enabled: canPoll,
    queryFn: async () => {
      const seq = ++requestSeqRef.current
      const payload = await fetchKpiRollout(supabase, storeIds)
      return { payload, seq }
    },
    refetchInterval: KPI_ROLLOUT_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: 1,
  })

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [enabled])

  const fresh = isKpiRolloutFresh(rollout.dataUpdatedAt, now)
  const rawEntry = fresh ? rollout.data : undefined
  const rawPayload = rawEntry?.payload
  const rawVersion = rawPayload ? Number(rawPayload.config_version) : 0
  const rawMode: KpiReaderMode = canPoll
    ? resolveKpiRolloutMode(rawPayload, fresh && Boolean(rawPayload))
    : 'legacy'
  const latestVersionRef = useRef(0)
  useEffect(() => {
    if (Number.isFinite(rawVersion) && rawVersion > latestVersionRef.current) {
      latestVersionRef.current = rawVersion
    }
  }, [rawVersion])
  useEffect(() => {
    if (rawMode === 'legacy' && previousRawModeRef.current !== 'legacy') {
      // Une réponse en vol avant le retour legacy ne doit pas le réactiver.
      minAcceptedSeqRef.current = requestSeqRef.current + (fresh && rawPayload ? 0 : 1)
    }
    previousRawModeRef.current = rawMode
  }, [rawMode, fresh, rawPayload])
  // Une réponse tardive d'une version antérieure ne doit jamais réactiver V5.
  const data =
    rawEntry &&
    acceptsRolloutEntry(
      rawEntry,
      minAcceptedSeqRef.current,
      latestVersionRef.current,
    )
      ? rawEntry.payload
      : undefined
  const mode: KpiReaderMode = canPoll
    ? resolveKpiRolloutMode(data, fresh && Boolean(data))
    : 'legacy'

  const configVersion = data?.config_version ?? 'stale'
  const shadowDate = useMemo(
    () => businessRange('today', null, null, new Date(), BUSINESS_TIME_ZONE, 365).from,
    [],
  )
  const shadowSampled = useMemo(
    () => Math.random() * 100 < (data?.shadow_sample_pct ?? 0),
    [configVersion, data?.shadow_sample_pct],
  )

  const shadowCheck = useQuery({
    queryKey: [
      'dashboard-kpi-shadow-check',
      boundary,
      currentStoreId,
      shadowDate,
      configVersion,
    ],
    enabled: canPoll && mode === 'shadow' && Boolean(currentStoreId) && shadowSampled,
    queryFn: () => fetchKpiShadowCheck(supabase, currentStoreId as string, shadowDate),
    staleTime: KPI_ROLLOUT_SHADOW_STALE_MS,
    refetchOnWindowFocus: false,
    retry: 0,
  })

  const previousRef = useRef<string | null>(null)
  useEffect(() => {
    const current = `${mode}:${configVersion}`
    if (previousRef.current && previousRef.current !== current) {
      queryClient.removeQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          typeof query.queryKey[0] === 'string' &&
          CACHE_PREFIXES.includes(query.queryKey[0]),
      })
      void reportKpiRolloutEvent(supabase, {
        storeIds,
        mode,
        event: 'mode_change',
        widget: 'dashboard',
        configVersion,
        details: { previous: previousRef.current, current },
      })
    }
    previousRef.current = current
  }, [mode, configVersion, queryClient, storeIds, supabase])

  useEffect(() => {
    if (!shadowCheck.data) return
    void reportKpiRolloutEvent(supabase, {
      storeIds,
      mode,
      event: 'shadow_check',
      widget: 'dashboard',
      configVersion,
      details: {
        comparable: shadowCheck.data.comparable,
        match: shadowCheck.data.match,
        diff_count: shadowCheck.data.diff_count,
        diff_fields: shadowCheck.data.diff_fields,
        reason: shadowCheck.data.reason ?? null,
      },
    })
  }, [shadowCheck.data, storeIds, mode, configVersion, supabase])

  useEffect(() => {
    if (!shadowCheck.error) return
    void reportKpiRolloutEvent(supabase, {
      storeIds,
      mode,
      event: 'shadow_error',
      widget: 'dashboard',
      errorCode: 'SHADOW_CHECK_FAILED',
      configVersion,
    })
  }, [shadowCheck.error, storeIds, mode, configVersion, supabase])

  const value = useMemo<KpiRolloutContextValue>(
    () => ({
      enabled,
      mode,
      requestedMode: data?.requested_mode ?? 'legacy',
      configVersion,
      shadowSamplePct: data?.shadow_sample_pct ?? 0,
      killSwitch: data?.kill_switch ?? true,
      stale: enabled && canPoll && !fresh,
      degraded: enabled && rollout.isError,
      resolved: !enabled || !canPoll || rollout.isFetched,
      currentStoreId,
      storeIds,
      accessFingerprint,
    }),
    [
      enabled,
      mode,
      data?.requested_mode,
      data?.shadow_sample_pct,
      data?.kill_switch,
      configVersion,
      canPoll,
      fresh,
      rollout.isError,
      rollout.isFetched,
      currentStoreId,
      storeIds,
      accessFingerprint,
    ],
  )

  return (
    <KpiRolloutContext.Provider value={value}>
      {children}
    </KpiRolloutContext.Provider>
  )
}

export function useKpiRollout(): KpiRolloutContextValue {
  return useContext(KpiRolloutContext)
}

/** Sonde non visible, utilisée par les tests navigateur et le support. */
export function KpiRolloutProbe() {
  const rollout = useKpiRollout()
  return (
    <span
      hidden
      data-kpi-enabled={String(rollout.enabled)}
      data-kpi-resolved={String(rollout.resolved)}
      data-kpi-mode={rollout.mode}
      data-kpi-config-version={rollout.configVersion}
      data-kpi-kill-switch={String(rollout.killSwitch)}
      data-kpi-stale={String(rollout.stale)}
    />
  )
}

/** Erreur du lecteur V5 : télémétrie sans valeur financière ni donnée client. */
export function useKpiReaderErrorTelemetry(
  widget: string,
  enabled: boolean,
  isError: boolean,
): void {
  const rollout = useKpiRollout()
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    if (!enabled || !isError) return
    void reportKpiRolloutEvent(supabase, {
      storeIds: rollout.storeIds,
      mode: rollout.mode,
      event: 'reader_error',
      widget,
      errorCode: 'KPI_READER_FAILED',
      configVersion: rollout.configVersion,
    })
  }, [
    enabled,
    isError,
    widget,
    supabase,
    rollout.storeIds,
    rollout.mode,
    rollout.configVersion,
  ])
}
