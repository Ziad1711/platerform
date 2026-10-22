'use client'

// ============================================================
// Suivi livraison : rattrapage a l'ouverture de l'espace protege.
//
// - Les donnees deja enregistrees s'affichent immediatement (aucun blocage).
// - Le rattrapage est demande quand le SERVEUR dit qu'il est necessaire
//   (travail en attente, ou suivi jamais effectue) : cela fonctionne donc des
//   le PREMIER acces, meme avec des tables de suivi vides.
// - Multi-store : chaque store a son verdict, aucun n'est masque par un autre.
// - Le verrou et le delai minimum sont imposes cote serveur.
// - Les vues ne sont invalidees que si une version de donnees a avance.
// - Polling leger, borne, uniquement pendant un traitement actif et onglet visible.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { useStore } from '@/lib/store-context'

type ProviderState = {
  provider: string
  lastSuccessAt: string | null
  lastCompleteAt: string | null
  outcome: 'complete' | 'partial' | 'failed' | 'not_configured' | null
  error: string | null
  changed: number
  failed: number
}

type ProviderDetail = ProviderState & {
  inProgress: boolean
  needsCatchUp: boolean
  coverage: {
    eligible: number
    excluded: number
    fresh: number
    stale: number
    untracked: number
    active: number
    unresolved: number
    ready: number
    backoff: number
    blocked: number
    remaining: number
    neverSynced: number
  }
}

type StoreFreshness = {
  storeId: string
  providers: ProviderState[]
  stale: boolean
  lastCompleteAt: string | null
  lastAttemptAt: string | null
  dataVersion: string
}

type StoreDetail = {
  storeId: string
  configuredProviders: number
  providers: ProviderDetail[]
  needsCatchUp: boolean
  inProgress: boolean
  dataVersion: string
}

type StatusResponse = {
  stores?: StoreFreshness[]
  store?: StoreDetail | null
  needsCatchUp?: boolean
  thresholdMs?: number
  error?: string
}

type CatchUpResponse = {
  skipped?: string
  changed?: number
  failed?: number
  pending?: number
  truncated?: boolean
  results?: Array<{ provider: string; outcome: string; reason?: string }>
  stores?: StoreFreshness[]
  store?: StoreDetail | null
  error?: string
}

const POLL_INTERVAL_MS = 10_000
const MAX_POLLS = 10
/** En mode « tous les stores », on ne relance que les stores en retard, bornes. */
const MAX_TARGETS_PER_CATCH_UP = 3

/** Vues impactees par un changement de statut de commande. */
const AFFECTED_QUERY_KEYS = [
  ['orders'],
  ['invoices'],
  ['dashboard-kpis'],
  ['dashboard-business-trends'],
  ['dashboard-profit-chart'],
  ['dashboard-top-products'],
  ['dashboard-ads-cost-chart'],
  ['dashboard-recent-orders'],
  ['dashboard-city-performance'],
  ['dashboard-confirmation-performance'],
  ['dashboard-order-time-performance'],
  ['finance-overview'],
  ['finance-kpi-summary'],
  ['finance-trend-chart'],
  ['finance-agent-balances'],
]

function formatRelative(value: string | null) {
  if (!value) return 'jamais'
  const elapsed = Date.now() - new Date(value).getTime()
  if (Number.isNaN(elapsed) || elapsed < 0) return "a l'instant"
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return "a l'instant"
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  return `il y a ${Math.floor(hours / 24)} j`
}

export default function DeliveryTrackingStatus() {
  const { currentStoreId } = useStore()
  // Chaque sélection (store précis ou « Tous les magasins ») possède son propre
  // état, remonté à chaque changement : aucune donnée, erreur, spinner, timer ou
  // requête d'une sélection précédente ne peut persister.
  const selectionKey = currentStoreId ?? 'all'
  return (
    <DeliveryTrackingStatusBySelection
      key={selectionKey}
      currentStoreId={currentStoreId}
    />
  )
}

function DeliveryTrackingStatusBySelection({
  currentStoreId,
}: {
  currentStoreId: string | null
}) {
  const queryClient = useQueryClient()
  const [stores, setStores] = useState<StoreFreshness[]>([])
  const [detail, setDetail] = useState<StoreDetail | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  // Sélection à laquelle appartiennent `detail`/`stores` affichés : tant que la
  // donnée ne correspond pas à la sélection courante, elle est masquée (le rendu
  // n'affiche jamais un état appartenant à une sélection précédente).
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined)
  const pollsRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const versionRef = useRef<Map<string, string>>(new Map())
  const lastCatchUpRef = useRef<Map<string, number>>(new Map())
  const currentStoreRef = useRef(currentStoreId)
  const loadAbortRef = useRef<AbortController | null>(null)
  const loadGenerationRef = useRef(0)
  const catchUpAbortRef = useRef<AbortController | null>(null)
  const catchUpGenerationRef = useRef(0)

  useEffect(() => {
    currentStoreRef.current = currentStoreId
    // Changement de sélection (y compris vers/depuis « Tous les stores ») :
    // invalider les générations et annuler les opérations en vol afin qu'une
    // réponse d'une sélection précédente (ex. rattrapage global) ne réécrive
    // jamais l'état affiché ni n'invalide des vues à tort.
    loadGenerationRef.current += 1
    catchUpGenerationRef.current += 1
    loadAbortRef.current?.abort()
    catchUpAbortRef.current?.abort()
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    pollsRef.current = 0
    // Ne pas laisser un « syncing » orphelin d'un rattrapage de la sélection
    // précédente (son finally est ignoré car génération périmée).
    setSyncing(false)
    // Rattacher l'état affiché à la sélection : aucun statut ni message de
    // l'ancienne sélection ne doit rester visible pendant le chargement.
    setDetail(null)
    setStores([])
    setErrorMessage('')
    setLoadedFor(undefined)
  }, [currentStoreId])

  // Nettoyage au démontage (dont changement d'identité, qui remonte ce composant) :
  // invalider les générations (monotones, jamais recyclées), annuler les requêtes
  // en vol et stopper le polling afin qu'aucune réponse obsolète ne réécrive l'état.
  useEffect(() => {
    return () => {
      loadGenerationRef.current += 1
      catchUpGenerationRef.current += 1
      loadAbortRef.current?.abort()
      catchUpAbortRef.current?.abort()
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const refreshAffectedViews = useCallback(() => {
    for (const key of AFFECTED_QUERY_KEYS) {
      queryClient.invalidateQueries({ queryKey: key })
    }
  }, [queryClient])

  /** Invalide uniquement si une version de donnees a reellement avance. */
  const applyFreshness = useCallback(
    (next: StoreFreshness[]) => {
      let advanced = false
      for (const store of next) {
        const previous = versionRef.current.get(store.storeId)
        if (previous !== undefined && previous !== store.dataVersion) advanced = true
        versionRef.current.set(store.storeId, store.dataVersion)
      }
      setStores(next)
      if (advanced) refreshAffectedViews()
    },
    [refreshAffectedViews]
  )

  const loadStatus = useCallback(async () => {
    const requestedStore = currentStoreId
    const generation = ++loadGenerationRef.current
    loadAbortRef.current?.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller
    try {
      const url = requestedStore
        ? `/api/integrations/delivery/tracking/sync?storeId=${encodeURIComponent(requestedStore)}`
        : '/api/integrations/delivery/tracking/sync'
      const response = await fetch(url, {
        cache: 'no-store',
        // Budget navigateur : un statut qui ne revient pas ne bloque jamais le
        // Dashboard ni le reste de l'interface.
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
      })
      const payload = (await response.json().catch(() => null)) as StatusResponse | null
      // Reponse d'un store qui n'est plus celui affiche : ignoree (aucun
      // melange de donnees entre deux stores). Les reponses d'une generation
      // depassee sont aussi ignorees (pas d'ecrasement par une requete lente).
      if (generation !== loadGenerationRef.current) return null
      if (requestedStore !== currentStoreRef.current) return null
      if (!response.ok) {
        setLoadedFor(requestedStore)
        setErrorMessage(payload?.error || 'DELIVERY_TRACKING_STATUS_FAILED')
        return null
      }
      setLoadedFor(requestedStore)
      setErrorMessage('')
      if (payload?.stores) applyFreshness(payload.stores)
      setDetail(payload?.store ?? null)
      return payload
    } catch {
      if (generation !== loadGenerationRef.current) return null
      if (requestedStore !== currentStoreRef.current) return null
      // Un echec de lecture n'est jamais silencieux.
      setLoadedFor(requestedStore)
      setErrorMessage('Suivi indisponible (lecture impossible)')
      return null
    }
  }, [currentStoreId, applyFreshness])

  const catchUp = useCallback(
    async (payloadBody: { storeId?: string; storeIds?: string[] }, force: boolean) => {
      const generation = ++catchUpGenerationRef.current
      catchUpAbortRef.current?.abort()
      const controller = new AbortController()
      catchUpAbortRef.current = controller
      setSyncing(true)
      try {
        const response = await fetch('/api/integrations/delivery/tracking/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payloadBody, force }),
          signal: controller.signal,
        })
        const payload = (await response.json().catch(() => null)) as CatchUpResponse | null
        if (generation !== catchUpGenerationRef.current) return null
        if (!response.ok) throw new Error(payload?.error || 'DELIVERY_TRACKING_SYNC_FAILED')

        // Reponse d'un store qui n'est plus celui affiche : ignoree.
        if (payloadBody.storeId && payloadBody.storeId !== currentStoreRef.current) return null

        if (payload?.stores) applyFreshness(payload.stores)
        setDetail(payload?.store ?? null)
        if ((payload?.changed || 0) > 0) refreshAffectedViews()
        if (payload?.failed) setErrorMessage(`${payload.failed} colis en erreur chez le transporteur`)
        else setErrorMessage('')
        return payload
      } catch (error) {
        if (generation !== catchUpGenerationRef.current) return null
        setErrorMessage(error instanceof Error ? error.message : 'DELIVERY_TRACKING_SYNC_FAILED')
        return null
      } finally {
        // Seul le rattrapage le plus recent peut refermer l'etat « syncing » :
        // un rattrapage depasse ne masque pas un rattrapage encore en cours.
        if (generation === catchUpGenerationRef.current) setSyncing(false)
      }
    },
    [applyFreshness, refreshAffectedViews]
  )

  const startPolling = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      if (document.visibilityState !== 'visible' || pollsRef.current >= MAX_POLLS) return
      pollsRef.current += 1
      // Seul un traitement REELLEMENT en cours (couverture « active ») justifie
      // de continuer : aucune valeur memorisee d'une reponse precedente.
      const payload = await loadStatus()
      if (payload?.store?.inProgress) startPolling()
    }, POLL_INTERVAL_MS)
  }, [loadStatus])

  // Verification de fraicheur a l'arrivee dans l'espace protege.
  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const payload = await loadStatus()
      if (cancelled || !payload) return

      const now = Date.now()
      const canAttempt = (storeId: string) => now - (lastCatchUpRef.current.get(storeId) || 0) > 60_000

      if (currentStoreId && payload.store?.needsCatchUp && canAttempt(currentStoreId)) {
        lastCatchUpRef.current.set(currentStoreId, now)
        const result = await catchUp({ storeId: currentStoreId }, false)
        if (cancelled) return
        // Le lot est execute DANS cette requete : rien de notre fait ne
        // continue apres la reponse. On ne sonde donc que si un AUTRE worker
        // est reellement en cours (couverture « active »), jamais sur
        // `truncated` — qui signifie seulement que le serveur s'est arrete.
        if (Boolean(result?.store?.inProgress)) {
          pollsRef.current = 1
          startPolling()
        }
        return
      }

      // Mode « tous les stores » : on relance les stores en retard, bornes.
      if (!currentStoreId) {
        const stale = (payload.stores || [])
          .filter((store) => store.stale && canAttempt(store.storeId))
          .slice(0, MAX_TARGETS_PER_CATCH_UP)
          .map((store) => store.storeId)

        if (stale.length === 0) return
        for (const storeId of stale) lastCatchUpRef.current.set(storeId, now)
        // Mode multi-store : l'etat leger ne porte pas d'indicateur « en cours ».
        // Aucun sondage n'est donc lance ici — on ne sonde jamais sans signal
        // d'activite reel (la prochaine visite ou le retour d'onglet suffit).
        await catchUp({ storeIds: stale }, false)
      }
    }

    run()

    // Retour sur l'onglet : une seule relecture (pas de polling permanent).
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      void loadStatus().then((payload) => {
        if (cancelled) return
        if (payload?.store?.inProgress) {
          pollsRef.current = 1
          startPolling()
        }
      })
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [currentStoreId, loadStatus, catchUp, startPolling])

  // ---- Rendu -------------------------------------------------------------
  // Masquer immédiatement toute donnée appartenant à une sélection précédente :
  // le rendu ne s'appuie que sur des données chargées pour la sélection courante.
  const dataMatchesSelection = loadedFor === currentStoreId
  const visibleDetail = dataMatchesSelection ? detail : null
  const visibleStores = dataMatchesSelection ? stores : []

  const providers = visibleDetail?.providers || []
  const staleStores = visibleStores.filter((store) => store.storeId !== currentStoreId && store.stale)
  const blocked = providers.reduce((total, provider) => total + provider.coverage.blocked, 0)
  const unrecognized = providers.reduce((total, provider) => total + provider.coverage.unresolved, 0)
  const pending = visibleDetail?.providers.reduce((total, provider) => total + provider.coverage.remaining, 0) || 0
  const failedProviders = providers.filter((provider) => provider.outcome === 'failed')
  // Ne JAMAIS deduire « jamais suivi » d'une liste vide (mode tous les stores).
  const neverSynced = providers.length > 0 && providers.every((provider) => !provider.lastSuccessAt)

  // Rien a afficher si ce store ne suit aucun colis ni en cours ni connu.
  const hasSomething = currentStoreId
    ? Boolean(visibleDetail && visibleDetail.configuredProviders > 0)
    : visibleStores.some((store) => store.providers.length > 0)

  if (!hasSomething && !errorMessage) return null

  const label = errorMessage
    ? `Suivi : ${errorMessage}`
    : syncing
      ? 'Synchronisation du suivi...'
      : failedProviders.length > 0
        ? `Suivi en echec (${failedProviders.map((provider) => provider.provider).join(', ')})`
        : visibleDetail?.inProgress
          ? 'Suivi en cours'
          : neverSynced
            ? 'Suivi jamais effectue'
            : blocked > 0 || unrecognized > 0 || pending > 0
              ? `Suivi incomplet (${pending} colis)`
              : stallsLabel(visibleDetail)

  const tone = errorMessage
    ? 'text-amber-600 bg-amber-500/10 border-amber-500/20'
    : failedProviders.length > 0
      ? 'text-red-600 bg-red-500/10 border-red-500/20'
      : syncing || visibleDetail?.inProgress
        ? 'text-[#1fa971] bg-[#1fa971]/10 border-[#1fa971]/20'
        : blocked > 0 || unrecognized > 0 || pending > 0 || neverSynced
          ? 'text-amber-600 bg-amber-500/10 border-amber-500/20'
          : 'text-muted-foreground bg-muted/40 border-border'

  const title = [
    ...providers.map(
      (provider) =>
        `${provider.provider}: ${provider.outcome || 'jamais'} — dernier succes ${formatRelative(
          provider.lastSuccessAt
        )}, complet ${formatRelative(provider.lastCompleteAt)} — en attente ${provider.coverage.remaining}, frais ${provider.coverage.fresh}, anciens ${provider.coverage.stale}` +
        (provider.coverage.blocked > 0 ? `, bloques ${provider.coverage.blocked}` : '') +
        (provider.coverage.unresolved > 0 ? `, non resolus ${provider.coverage.unresolved}` : '') +
        (provider.error ? ` — ${provider.error}` : '')
    ),
    staleStores.length > 0 ? `Autres stores en retard : ${staleStores.length}` : '',
    errorMessage,
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <div className="flex justify-end px-3 pt-2 sm:px-4 lg:px-6">
      <button
        type="button"
        title={title}
        onClick={() =>
          catchUp(
            currentStoreId
              ? { storeId: currentStoreId }
              : { storeIds: staleStores.slice(0, MAX_TARGETS_PER_CATCH_UP).map((store) => store.storeId) },
            true
          )
        }
        disabled={syncing || (!currentStoreId && staleStores.length === 0)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-70 ${tone}`}
      >
        {syncing || visibleDetail?.inProgress ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : failedProviders.length > 0 ? (
          <TriangleAlert className="h-3.5 w-3.5" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        <span className="max-w-[240px] truncate">{label}</span>
        {staleStores.length > 0 ? <span className="opacity-70">+{staleStores.length}</span> : null}
      </button>
    </div>
  )
}

/** Libelle honnete : « a jour » seulement si tout est reellement traite. */
function stallsLabel(detail: StoreDetail | null) {
  if (!detail) return 'Suivi a jour'
  const last = detail.providers
    .map((provider) => provider.lastCompleteAt)
    .filter((value): value is string => Boolean(value))
    // Date la PLUS ANCIENNE : le transporteur le plus en retard donne le rythme,
    // aucun ne doit etre masque par un autre.
    .sort()
    .shift()
  return `Suivi a jour ${formatRelative(last || null)}`
}
