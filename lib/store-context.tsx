'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode, Fragment } from 'react'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import type { DashboardPeriod } from '@/lib/utils'
import type { Role } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/client'
import { loadStoreAccess, STORE_ACCESS_TIMEOUT_MS } from '@/lib/auth/store-access'
import { toAccessMap } from '@/lib/auth/store-bootstrap'
import type { AccessibleStore, AppBootstrap, StoreSelection } from '@/lib/auth/store-bootstrap'
import {
  LEGACY_STORE_COOKIE,
  parseStorePreference,
  STORE_ACCESS_EVENT_KEY,
  STORE_PREFERENCE_COOKIE,
  STORE_PREFERENCE_STORAGE_KEY,
  serializeStorePreference,
  selectionToPreference,
  selectionToRawStoreId,
} from '@/lib/store-selection'

interface StoreContextType {
  currentStoreId: string | null
  /** undefined = pas encore initialisé, null = "Tous les stores" */
  _rawStoreId: string | null | undefined
  setCurrentStoreId: (storeId: string | null) => void
  accessibleStores: AccessibleStore[]
  accessibleStoreIds: string[]
  /** Sélection effective (validée contre les appartenances actives). */
  selection: StoreSelection
  isStoresLoading: boolean
  /** true quand la lecture des appartenances a échoué (jamais une absence de magasins). */
  storesError: boolean
  /** Relance la lecture des appartenances/magasins. */
  retryStores: () => void
  selectedPeriod: DashboardPeriod
  setSelectedPeriod: (period: DashboardPeriod) => void
  customStartDate: string | null
  setCustomStartDate: (date: string | null) => void
  customEndDate: string | null
  setCustomEndDate: (date: string | null) => void
  /** L'ID de l'utilisateur authentifié, null si pas connecté */
  userId: string | null
  /** true quand l'état auth a été initialisé */
  authReady: boolean
}

const StoreContext = createContext<StoreContextType | undefined>(undefined)

/**
 * Sélection réconciliée avec la liste confirmée : renvoie l'objet courant
 * inchangé quand rien ne change (aucune réécriture de préférence inutile).
 */
function reconcileSelection(current: StoreSelection, stores: AccessibleStore[]): StoreSelection {
  if (stores.length === 0) {
    return current.mode === 'none' ? current : { mode: 'none', storeId: null }
  }
  if (current.mode === 'store' && stores.some((store) => store.id === current.storeId)) return current
  if (current.mode === 'all') return current
  if (stores.length === 1) return { mode: 'store', storeId: stores[0].id }
  return { mode: 'all', storeId: null }
}

/**
 * Attribut `Secure` uniquement en HTTPS : sur localhost HTTP, un cookie `Secure`
 * serait refusé par le navigateur. La préférence n'étant qu'une préférence (jamais
 * une autorisation), elle reste lisible par le script ; aucun secret n'y transite.
 */
function cookieSecuritySuffix(): string {
  if (typeof window === 'undefined') return ''
  return window.location.protocol === 'https:' ? '; secure' : ''
}

/**
 * Persiste la sélection validée : préférence explicite (cookie + localStorage,
 * liée à l'utilisateur) et miroirs hérités `current-store-id` utilisés par le
 * middleware et quelques routes existantes.
 */
function persistSelection(selection: StoreSelection, userId: string | null) {
  if (typeof window === 'undefined' || !userId) return
  const legacyMaxAge = 60 * 60 * 24 * 365
  const preference = selectionToPreference(selection, userId)

  try {
    if (preference) {
      localStorage.setItem(STORE_PREFERENCE_STORAGE_KEY, serializeStorePreference(preference))
    } else {
      localStorage.removeItem(STORE_PREFERENCE_STORAGE_KEY)
    }
    localStorage.setItem(
      LEGACY_STORE_COOKIE,
      selection.mode === 'store' ? selection.storeId : '',
    )
  } catch {
    // Stockage indisponible : la préférence serveur reste l'autorité.
  }

  if (preference) {
    document.cookie = `${STORE_PREFERENCE_COOKIE}=${encodeURIComponent(
      serializeStorePreference(preference),
    )}; path=/; max-age=${legacyMaxAge}; samesite=lax${cookieSecuritySuffix()}`
  } else {
    document.cookie = `${STORE_PREFERENCE_COOKIE}=; path=/; max-age=0`
  }

  if (selection.mode === 'store') {
    document.cookie = `${LEGACY_STORE_COOKIE}=${selection.storeId}; path=/; max-age=${legacyMaxAge}; samesite=lax${cookieSecuritySuffix()}`
  } else {
    document.cookie = `${LEGACY_STORE_COOKIE}=; path=/; max-age=0`
  }
}

/** Signale aux autres onglets qu'une mutation d'accès a eu lieu (sans donnée privée). */
export function publishStoreAccessChange() {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORE_ACCESS_EVENT_KEY, String(Date.now()))
  } catch {
    // Sans stockage partagé, la revalidation au focus reste le filet de sécurité.
  }
}

export function StoreProvider({
  children,
  initialUserId,
  initialAuthReady,
  initialBootstrap,
}: {
  children: ReactNode
  initialUserId: string | null
  initialAuthReady: boolean
  initialBootstrap: AppBootstrap
}) {
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()
  // Garde contre les callbacks tardifs d'un compte précédent : après démontage
  // (changement d'identité), plus aucun écriture de sélection persistée.
  const disposedRef = useRef(false)
  useEffect(() => {
    // Réactiver la garde à chaque installation : Strict Mode exécute
    // installation → nettoyage → installation, et le setter doit rester actif
    // après ce cycle tant que le composant est monté.
    disposedRef.current = false
    return () => {
      disposedRef.current = true
    }
  }, [])

  // Instantané serveur : la sélection transmise est déjà validée contre les
  // appartenances actives, aucun état « pas encore initialisé » n'est nécessaire
  // et aucune lecture initiale n'est répétée dans le navigateur.
  const bootstrapReady = initialBootstrap.status === 'ready'

  const [selection, setSelection] = useState<StoreSelection>(() =>
    initialBootstrap.status === 'ready'
      ? initialBootstrap.selection
      : { mode: 'none', storeId: null },
  )
  // Version de la frontière privée : incrémentée quand une revalidation confirme
  // une révocation, afin de remonter les consommateurs (vider leur état local).
  const [accessVersion, setAccessVersion] = useState(0)
  // Incrémenté quand une intention externe vient d'être tranchée : la persistance
  // doit reprendre même si la sélection effective n'a pas changé (une valeur
  // identique ne provoque aucun rendu, donc aucun effet de persistance).
  const [persistenceRevision, setPersistenceRevision] = useState(0)

  const [selectedPeriod, setSelectedPeriod] = useState<DashboardPeriod>('month')
  const [customStartDate, setCustomStartDate] = useState<string | null>(null)
  const [customEndDate, setCustomEndDate] = useState<string | null>(null)

  // Dernière liste confirmée, lue par le setter et par la synchronisation
  // inter-onglets : une sélection n'est acceptée que si le magasin est autorisé.
  const latestStoresRef = useRef<AccessibleStore[]>([])

  // Intention de sélection reçue d'un autre onglet, en attente de validation par
  // la liste confirmée : elle n'est jamais exposée avant d'être autorisée. La
  // dernière intention reçue remplace la précédente ; un choix local l'annule.
  // Chaque intention porte sa génération : une finalisation planifiée ne peut donc
  // jamais appliquer une intention déjà remplacée.
  const pendingSelectionRef = useRef<{
    generation: number
    selection: { mode: 'all' } | { mode: 'store'; storeId: string }
  } | null>(null)
  // Génération des intentions de sélection (externe ou locale) : tout changement
  // d'intention l'incrémente.
  const selectionIntentRef = useRef(0)

  const setCurrentStoreId = useCallback((storeId: string | null) => {
    // Un callback tardif (ex. mutation de création de store du compte A) ne doit
    // plus écrire dans la sélection persistée du compte courant.
    if (disposedRef.current) return
    // Un choix local rend obsolètes les intentions reçues d'autres onglets.
    pendingSelectionRef.current = null
    selectionIntentRef.current += 1
    const stores = latestStoresRef.current

    // « Tous les magasins » n'a de sens qu'avec des magasins : sinon la
    // sélection reste « aucun ».
    if (storeId === null) {
      if (stores.length === 0) return
      setSelection({ mode: 'all', storeId: null })
      return
    }

    // Une préférence n'est jamais une autorisation : un identifiant non confirmé
    // par les appartenances actives est rejeté.
    if (!stores.some((store) => store.id === storeId)) return
    setSelection({ mode: 'store', storeId })
  }, [])

  const {
    data: accessSnapshot,
    dataUpdatedAt,
    isLoading,
    isError,
    refetch: retryStores,
  } = useQuery({
    queryKey: ['accessible-stores', initialUserId],
    enabled: initialAuthReady && Boolean(initialUserId),
    // Conserver le dernier contexte confirmé pendant une revalidation : une
    // panne de relecture ne doit pas vider les magasins ni la sélection.
    placeholderData: keepPreviousData,
    // Le serveur a déjà lu les accès : ce premier instantané sert de données
    // initiales, sans refetch de montage ni cascade Auth → appartenances →
    // magasins côté navigateur. La revalidation reste active (focus, reconnexion,
    // invalidation explicite après mutation) et ne remplace `data` que si elle
    // réussit.
    initialData: bootstrapReady ? initialBootstrap.access : undefined,
    initialDataUpdatedAt: bootstrapReady ? initialBootstrap.access.fetchedAt : undefined,
    staleTime: 0,
    refetchOnMount: false,
    // Revalidation au focus/reconnexion conservée (droits modifiés ailleurs), mais
    // AUCUN retry implicite : la borne de 12 s doit être celle de l'opération
    // entière, pas d'une tentative répétée sans fin.
    retry: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async ({ signal }) => {
      if (!initialUserId) {
        return { stores: [] as AccessibleStore[], fetchedAt: Date.now() }
      }

      // La revalidation navigateur est bornée comme la lecture serveur : une
      // lecture qui ne revient pas ne doit jamais laisser un chargement sans fin.
      // Le signal React Query (annulation, démontage) reste honoré, y compris
      // s'il était déjà annulé avant l'installation de l'écouteur.
      const controller = new AbortController()
      const abortFromQuery = () => controller.abort()
      const timer = setTimeout(() => controller.abort(), STORE_ACCESS_TIMEOUT_MS)
      if (signal?.aborted) {
        controller.abort()
      } else {
        signal?.addEventListener('abort', abortFromQuery)
      }

      try {
        // Une seule règle de lecture, partagée avec le bootstrap serveur : les
        // appartenances actives ET leurs rôles, filtrés par la RLS.
        return await loadStoreAccess(supabase, initialUserId, controller.signal)
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abortFromQuery)
      }
    },
  })

  const accessibleStores: AccessibleStore[] = accessSnapshot?.stores ?? []
  latestStoresRef.current = accessibleStores

  const hasStoresSnapshot = accessSnapshot !== undefined
  const isStoresLoading =
    !initialAuthReady || (Boolean(initialUserId) && isLoading && !hasStoresSnapshot)
  // Une erreur de lecture des appartenances n'est PAS une absence de magasins :
  // elle est signalée séparément et ne doit ni effacer la sélection ni déclencher
  // un faux onboarding.
  const isStoresError = Boolean(initialUserId) && isError

  // Sélection EFFECTIVE du rendu courant : la liste confirmée fait autorité, une
  // préférence devenue invalide n'est donc jamais exposée ni persistée pendant le
  // rendu qui suit une révocation (`reconcileSelection` renvoie l'objet courant
  // inchangé quand rien ne change, ce qui évite toute réécriture inutile).
  const effectiveSelection = reconcileSelection(selection, accessibleStores)

  // Réconciliation de la sélection : uniquement quand la liste est chargée SANS
  // erreur. Une panne de lecture ne doit pas effacer la sélection persistée.
  useEffect(() => {
    if (isStoresLoading || isStoresError) return
    setSelection((current) => reconcileSelection(current, accessibleStores))
  }, [accessibleStores, isStoresLoading, isStoresError])

  // Persistance de la sélection EFFECTIVE (jamais d'une préférence non validée) :
  // le miroir serveur (cookie) est réécrit pour la prochaine requête et les
  // miroirs hérités restent cohérents avec le middleware. La sélection persistée
  // est celle validée contre la liste du rendu courant : un magasin qui vient
  // d'être retiré n'est donc jamais réécrit. Tant qu'une intention externe attend
  // sa décision, rien n'est publié : l'autre onglet ne doit jamais recevoir une
  // préférence intermédiaire.
  useEffect(() => {
    if (!hasStoresSnapshot || isStoresError) return
    if (disposedRef.current) return
    if (pendingSelectionRef.current) return
    persistSelection(effectiveSelection, initialUserId)
  }, [
    effectiveSelection,
    hasStoresSnapshot,
    isStoresError,
    initialUserId,
    persistenceRevision,
  ])

  // Synchronisation inter-onglets : une préférence reçue n'est appliquée que si
  // elle appartient à l'utilisateur courant ET désigne un magasin encore
  // autorisé. Un marqueur d'accès déclenche une revalidation des appartenances.
  useEffect(() => {
    if (typeof window === 'undefined') return

    const onStorage = (event: StorageEvent) => {
      if (event.key === STORE_ACCESS_EVENT_KEY) {
        void queryClient.invalidateQueries({ queryKey: ['accessible-stores', initialUserId] })
        return
      }
      if (event.key !== STORE_PREFERENCE_STORAGE_KEY) return

      const preference = parseStorePreference(event.newValue)
      if (!preference || preference.userId !== initialUserId) return

      const stores = latestStoresRef.current
      const wanted = preference.selection
      // Toute nouvelle intention porte sa génération : une finalisation déjà
      // planifiée n'appliquera jamais une intention remplacée entre-temps.
      const intentGeneration = (selectionIntentRef.current += 1)

      if (wanted.mode === 'all') {
        if (stores.length > 0) {
          pendingSelectionRef.current = null
          setSelection({ mode: 'all', storeId: null })
        } else {
          // Aucun magasin confirmé dans cet onglet : l'intention est conservée puis
          // validée contre la liste relue.
          pendingSelectionRef.current = { generation: intentGeneration, selection: wanted }
          void queryClient.invalidateQueries({ queryKey: ['accessible-stores', initialUserId] })
        }
        return
      }
      if (stores.some((store) => store.id === wanted.storeId)) {
        pendingSelectionRef.current = null
        setSelection({ mode: 'store', storeId: wanted.storeId })
        return
      }
      // Magasin encore inconnu ici (créé ou partagé depuis un autre onglet) : les
      // accès sont relus AVANT toute exposition — jamais de sélection non validée.
      pendingSelectionRef.current = { generation: intentGeneration, selection: wanted }
      void queryClient.invalidateQueries({ queryKey: ['accessible-stores', initialUserId] })
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [initialUserId, queryClient])

  // Intention externe appliquée APRÈS confirmation de la liste : elle n'est jamais
  // exposée avant d'être autorisée, et elle est abandonnée (sans bruit) si le
  // magasin demandé n'est toujours pas accessible. Une erreur de relecture ne
  // consomme pas l'intention : le réessai pourra l'appliquer.
  useEffect(() => {
    if (isStoresLoading || isStoresError) return
    // Aucune donnée confirmée (placeholder seul) : aucune décision n'est prise.
    if (!accessSnapshot) return
    const pending = pendingSelectionRef.current
    if (!pending) return

    // Intention remplacée par une plus récente (choix local ou nouvelle intention
    // externe) : rien à appliquer, la persistance reprend immédiatement.
    if (pending.generation !== selectionIntentRef.current) {
      pendingSelectionRef.current = null
      setPersistenceRevision((revision) => revision + 1)
      return
    }

    pendingSelectionRef.current = null

    const intent = pending.selection
    if (intent.mode === 'all') {
      if (accessibleStores.length > 0) setSelection({ mode: 'all', storeId: null })
    } else if (accessibleStores.some((store) => store.id === intent.storeId)) {
      setSelection({ mode: 'store', storeId: intent.storeId })
    }

    // Intention tranchée (appliquée ou abandonnée) : la persistance peut reprendre,
    // même si la sélection effective n'a pas changé de valeur.
    setPersistenceRevision((revision) => revision + 1)
  }, [accessSnapshot, accessibleStores, dataUpdatedAt, isStoresLoading, isStoresError])

  // Nouveau contexte préparé par le serveur (ex. `router.refresh()` après création
  // de magasin) : les horloges serveur et navigateur n'étant pas comparables, aucun
  // instantané n'est injecté sur une comparaison de dates. À la place, une SEULE
  // revalidation dédupliquée est déclenchée : la lecture en cours est annulée pour
  // qu'une réponse obsolète ne remplace jamais le résultat courant, et la sélection
  // déjà choisie par l'utilisateur n'est pas réécrite (elle est réconciliée contre
  // la liste confirmée).
  const bootstrapRevisionRef = useRef(initialBootstrap)
  useEffect(() => {
    if (disposedRef.current) return
    // Le premier montage consomme déjà `initialData` : aucune requête ajoutée.
    if (bootstrapRevisionRef.current === initialBootstrap) return
    bootstrapRevisionRef.current = initialBootstrap
    if (initialBootstrap.status !== 'ready') return
    if (initialBootstrap.userId !== initialUserId) return

    void queryClient.cancelQueries({ queryKey: ['accessible-stores', initialUserId] })
    void queryClient.refetchQueries({ queryKey: ['accessible-stores', initialUserId] })
  }, [initialBootstrap, initialUserId, queryClient])

  // Purge des données privées quand un accès est révoqué OU qu'un rôle change.
  // Quand une revalidation confirme qu'un store précédemment accessible ne l'est
  // plus, ou que le rôle de l'utilisateur a changé pour un store conservé, on
  // vide toute la frontière privée et on remonte les consommateurs pour vider
  // leurs états locaux.
  const prevAccessRef = useRef<Record<string, Role | null> | null>(null)

  useEffect(() => {
    if (isStoresLoading || isStoresError) return

    const currentAccess = toAccessMap(accessibleStores)
    const previousAccess = prevAccessRef.current
    prevAccessRef.current = currentAccess

    // Premier chargement réussi : rien à purger.
    if (previousAccess === null) return

    // Un accès retiré (id absent) ou un rôle modifié (ex. rétrogradation)
    // sont traités de la même façon : les données lues avec l'ancien droit
    // doivent être purgées. Une erreur de lecture n'arrive jamais ici.
    const accessChanged = Object.keys(previousAccess).some(
      (id) => previousAccess[id] !== currentAccess[id]
    )
    if (!accessChanged) return

    // Révocation confirmée : retirer (et annuler) toutes les requêtes privées
    // (rôles, KPI, graphiques, caches agrégés « Tous les magasins », suivi) en
    // conservant uniquement le contexte magasins, pour ne pas recommencer sa
    // lecture.
    const isStoresContext = (query: { queryKey: readonly unknown[] }) =>
      query.queryKey.includes('accessible-stores')
    queryClient.cancelQueries({ predicate: (query) => !isStoresContext(query) })
    queryClient.removeQueries({ predicate: (query) => !isStoresContext(query) })

    // Renouvelle la frontière privée : remonter les consommateurs (tables, KPI,
    // graphiques, suivi) pour vider leurs états locaux et relire le contexte.
    setAccessVersion((version) => version + 1)
  }, [accessibleStores, isStoresLoading, isStoresError, queryClient])

  // Chargement : uniquement s'il n'existe AUCUN instantané confirmé (le serveur
  // en fournit un au premier rendu ; sinon une revalidation est en cours).
  if (isStoresLoading && !hasStoresSnapshot) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  // Erreur initiale de lecture des magasins : jamais présentée comme « aucun
  // magasin » ni comme un succès vide (pas de KPI nuls, pas de faux onboarding).
  // Une panne APRÈS un instantané confirmé n'efface rien : elle est signalée par
  // le bandeau ci-dessous, au-dessus des données déjà confirmées.
  if (isStoresError && !hasStoresSnapshot) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="mx-auto w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-lg">
          <h1 className="text-lg font-semibold">Impossible de charger vos magasins</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Une erreur est survenue lors de la lecture de vos accès. Vos données
            n&apos;ont pas été perdues.
          </p>
          <button
            type="button"
            onClick={() => retryStores()}
            className="mt-5 inline-block rounded-xl bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
          >
            Réessayer
          </button>
        </div>
      </div>
    )
  }

  // Masquer immédiatement les consommateurs privés dès qu'une revalidation
  // confirme un changement d'accès (magasin retiré OU rôle modifié), AVANT
  // l'effet de purge : le rendu ne doit jamais montrer un état privé lu avec
  // un droit qui n'est plus valide.
  const previousConfirmedAccess = prevAccessRef.current
  const currentConfirmedAccess = toAccessMap(accessibleStores)
  const isRevoking =
    !isStoresLoading &&
    !isStoresError &&
    previousConfirmedAccess !== null &&
    Object.keys(previousConfirmedAccess).some(
      (id) => previousConfirmedAccess[id] !== currentConfirmedAccess[id]
    )

  if (isRevoking) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  const accessibleStoreIds = accessibleStores.map((store) => store.id)

  // N'exposer QUE des sélections validées contre la liste réellement accessible :
  // la sélection vient du serveur ou d'une action utilisateur revalidée, jamais
  // d'une préférence brute non confirmée.
  const exposedStoreId: string | null =
    effectiveSelection.mode === 'store' ? effectiveSelection.storeId : null

  return (
    <StoreContext.Provider
      value={{
        currentStoreId: exposedStoreId,
        _rawStoreId: selectionToRawStoreId(effectiveSelection),
        setCurrentStoreId,
        accessibleStores,
        accessibleStoreIds,
        selection: effectiveSelection,
        isStoresLoading,
        storesError: isStoresError,
        retryStores,
        selectedPeriod,
        setSelectedPeriod,
        customStartDate,
        setCustomStartDate,
        customEndDate,
        setCustomEndDate,
        userId: initialUserId,
        authReady: initialAuthReady,
      }}
    >
      {/* key=accessVersion remonte les consommateurs privés à chaque révocation
          confirmée, vidant leurs états locaux. */}
      <Fragment key={accessVersion}>
        {isStoresError && accessibleStores.length > 0 && (
          <div className="fixed left-1/2 top-3 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs font-medium text-amber-600 shadow-sm">
            <span>
              Impossible de recharger vos magasins — les données affichées peuvent
              être obsolètes.
            </span>
            <button
              type="button"
              onClick={() => retryStores()}
              className="underline underline-offset-2 hover:opacity-80"
            >
              Réessayer
            </button>
          </div>
        )}
        {children}
      </Fragment>
    </StoreContext.Provider>
  )
}

export function useStore() {
  const context = useContext(StoreContext)
  if (context === undefined) {
    throw new Error('useStore must be used within a StoreProvider')
  }
  return context
}
