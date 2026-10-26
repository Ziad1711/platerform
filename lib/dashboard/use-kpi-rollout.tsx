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
  /** Rollout attendu mais décision pas encore tranchée (ni erreur définitive). */
  pending: boolean
  /** Décision impossible (erreur/expiration) sans configuration acceptée. */
  failed: boolean
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
  pending: false,
  failed: false,
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
  'dashboard-v5-order-counters',
  'dashboard-confirmation-counters',
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

  // Les tableaux du StoreProvider sont reconstruits à chaque rendu. Une dépendance
  // par référence réinitialisait le mode confirmé à chaque polling/tick.
  const storeIdsKey = (currentStoreId ? [currentStoreId] : accessibleStoreIds)
    .slice().sort().join('|')
  const storeIds = useMemo(() => (storeIdsKey ? storeIdsKey.split('|') : []), [storeIdsKey])

  const accessFingerprint = useMemo(
    () =>
      accessibleStores
        .map((store) => `${store.id}:${store.role ?? 'none'}`)
        .sort()
        .join('|'),
    [accessibleStores],
  )

  const canPoll = enabled && !isStoresLoading && storeIds.length > 0
  const scope = `${boundary}:${storeIdsKey}:${accessFingerprint}`
  const requestSeqRef = useRef(0)
  const minAcceptedSeqRef = useRef(0)
  const previousRawModeRef = useRef<KpiReaderMode>('legacy')
  const rollout = useQuery({
    queryKey: ['dashboard-kpi-rollout', boundary, storeIds, accessFingerprint],
    enabled: canPoll,
    queryFn: async ({ signal }) => {
      const seq = ++requestSeqRef.current
      const payload = await fetchKpiRollout(supabase, storeIds, signal)
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

  // Dernier mode explicitement confirmé par le serveur (kill switch et mode
  // demandé inclus). Une réponse périmée ou une erreur réseau ne doit plus
  // faire rebasculer l'interface vers l'ancien dashboard : le mode confirmé est
  // conservé, l'état `stale`/`degraded` signale seulement la fraîcheur.
  const [accepted, setAccepted] = useState<{ scope: string; mode: KpiReaderMode; version: string }>({
    scope: '',
    mode: 'legacy',
    version: '0',
  })

  const fresh = isKpiRolloutFresh(rollout.dataUpdatedAt, now)
  const rawEntry = fresh ? rollout.data : undefined
  const rawPayload = rawEntry?.payload
  const rawVersion = rawPayload ? Number(rawPayload.config_version) : 0
  const rawMode: KpiReaderMode = canPoll
    ? resolveKpiRolloutMode(rawPayload, fresh && Boolean(rawPayload))
    : 'legacy'
  // Les versions ne sont comparables qu'au sein d'une même frontière d'accès.
  // Une autre boutique peut avoir une version de configuration différente.
  const latestVersionRef = useRef({ scope: '', version: 0 })
  useEffect(() => {
    if (latestVersionRef.current.scope !== scope) {
      latestVersionRef.current = { scope, version: 0 }
    }
    if (Number.isFinite(rawVersion) && rawVersion > latestVersionRef.current.version) {
      latestVersionRef.current.version = rawVersion
    }
  }, [scope, rawVersion])
  useEffect(() => {
    if (fresh && rawPayload && rawMode === 'legacy' && previousRawModeRef.current !== 'legacy') {
      // Une réponse en vol avant le retour legacy ne doit pas le réactiver.
      minAcceptedSeqRef.current = requestSeqRef.current
    }
    if (fresh && rawPayload) previousRawModeRef.current = rawMode
  }, [rawMode, fresh, rawPayload])
  // Une réponse tardive d'une version antérieure ne doit jamais réactiver V5.
  const data =
    rawEntry &&
    acceptsRolloutEntry(
      rawEntry,
      minAcceptedSeqRef.current,
      latestVersionRef.current.scope === scope ? latestVersionRef.current.version : 0,
    )
      ? rawEntry.payload
      : undefined

  // Configuration reçue : elle seule peut changer de mode (y compris le kill
  // switch et un retour legacy explicitement demandé). Aucune écriture d'état
  // si le mode et la version sont identiques (pas de rendu inutile au polling).
  useEffect(() => {
    if (!data) return
    const nextMode: KpiReaderMode = data.kill_switch ? 'legacy' : data.selection_mode
    setAccepted((previous) =>
      previous.scope === scope && previous.mode === nextMode && previous.version === data.config_version
        ? previous
        : { scope, mode: nextMode, version: data.config_version },
    )
  }, [data, scope])

  const acceptedHere = accepted.scope === scope
  const mode: KpiReaderMode = canPoll && acceptedHere ? accepted.mode : 'legacy'
  const configVersion = acceptedHere ? accepted.version : '0'
  // États dérivés pour un rendu progressif : la structure du dashboard est
  // toujours affichée, seules les lectures financières attendent la décision.
  const resolved = !enabled || (canPoll && acceptedHere)
  const pending = enabled && !resolved && !rollout.isError
  const failed = enabled && !resolved && rollout.isError
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
      // Les enfants peuvent déjà observer la nouvelle clé legacy au moment
      // de cet effet. La supprimer détache leur QueryObserver et peut laisser
      // isLoading bloqué malgré une réponse RPC correcte dans une nouvelle
      // entrée du cache. Invalider conserve les abonnements et relit les données.
      void queryClient.invalidateQueries({
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
      resolved,
      pending,
      failed,
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
      acceptedHere,
      pending,
      failed,
      currentStoreId,
      storeIds,
      accessFingerprint,
    ],
  )

  // Rendu progressif : la structure du dashboard (en-tête, sélecteurs, enveloppes
  // des widgets) est toujours rendue immédiatement. Aucune source financière
  // n'est lancée tant que le mode legacy/V5 n'est pas tranché : les lectures
  // legacy sont déjà conditionnées à `rollout.resolved` dans les composants, et
  // leur état de chargement s'appuie sur `rollout.pending`. En cas d'échec
  // définitif du rollout, une erreur locale NON bloquante est affichée — sans
  // jamais substituer silencieusement une autre source de chiffres.
  return (
    <KpiRolloutContext.Provider value={value}>
      {failed ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          Configuration des indicateurs indisponible. Les chiffres ne sont pas
          chargés pour éviter toute valeur erronée.
          <button
            type="button"
            onClick={() => void rollout.refetch()}
            className="ml-3 underline underline-offset-2 hover:opacity-80"
          >
            Réessayer
          </button>
        </div>
      ) : null}
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
