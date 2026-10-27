'use client'

import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { invalidateDashboardAnalytics } from '@/lib/dashboard/analytics-cache'
import { useState, createContext, useContext, useEffect, useMemo, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { StoreProvider, useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { readSessionKey, STORE_ACCESS_UNAVAILABLE } from '@/lib/auth/store-bootstrap'
import type { AppBootstrap } from '@/lib/auth/store-bootstrap'
import {
  LEGACY_STORE_COOKIE,
  STORE_PREFERENCE_COOKIE,
  STORE_PREFERENCE_STORAGE_KEY,
} from '@/lib/store-selection'
import { THEME_STORAGE_KEY, isThemeValue, type Theme } from '@/lib/theme-init'

const resolveTheme = (theme: Theme) => {
  if (theme === 'system') {
    if (typeof window === 'undefined') return 'light'
    const prefersDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    return prefersDarkMode ? 'dark' : 'light'
  }
  return theme
}

interface ThemeContextProps {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextProps>({
  theme: 'system',
  setTheme: () => {},
})

export function useTheme() {
  return useContext(ThemeContext)
}

function ThemeLoader() {
  // Client stable : recréé à chaque rendu, il relançait l'effet ci-dessous et
  // provoquait des relectures répétées de `theme_preference`.
  const supabase = useMemo(() => createClient(), [])
  const { setTheme } = useTheme()
  const { userId, authReady } = useStore()

  useEffect(() => {
    if (!authReady || !userId) return

    let isActive = true

    const loadThemeFromProfile = async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('theme_preference')
        .eq('id', userId)
        .maybeSingle()

      if (!isActive || !profile?.theme_preference || !isThemeValue(profile.theme_preference)) return

      // Un choix explicite fait sur cet appareil (bouton de thème) prime : il
      // n'est jamais enregistré en base par le bouton, donc l'écraser ici
      // changerait le thème de l'utilisateur à chaque chargement.
      try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY)
        if (stored === 'light' || stored === 'dark') return
      } catch {
        // Stockage indisponible : la préférence du profil reste applicable.
      }

      // `setTheme` avec la même valeur ne déclenche aucun rendu.
      setTheme(profile.theme_preference)
    }

    void loadThemeFromProfile()

    return () => {
      isActive = false
    }
  }, [authReady, userId, supabase, setTheme])

  return null
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  // `system` est la valeur SSR : le markup reste identique avant et après
  // hydratation (aucun mismatch sur l'icône du bouton de thème).
  const [theme, setTheme] = useState<Theme>('system')
  // Aucune application avant la relecture de la préférence stockée : appliquer
  // `system` d'abord écrasait la classe posée par le script d'amorçage (fond
  // sombre bref quand l'OS est sombre et la préférence claire).
  const [themeReady, setThemeReady] = useState(false)

  // Lecture unique de la préférence de l'appareil (aucune écriture ici : une
  // écriture transitoire pouvait remplacer la préférence par `system`).
  useEffect(() => {
    try {
      const storedTheme = localStorage.getItem(THEME_STORAGE_KEY)
      setTheme(isThemeValue(storedTheme) ? storedTheme : 'system')
    } catch {
      setTheme('system')
    }
    setThemeReady(true)
  }, [])

  // Application au DOM, uniquement après la lecture, sur la valeur retenue.
  useEffect(() => {
    if (!themeReady) return
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Stockage indisponible : le thème reste appliqué pour la session.
    }
    const htmlElement = document.documentElement
    const appliedTheme = resolveTheme(theme)
    if (appliedTheme === 'dark') {
      htmlElement.classList.add('dark')
      htmlElement.style.colorScheme = 'dark'
    } else {
      htmlElement.classList.remove('dark')
      htmlElement.style.colorScheme = 'light'
    }
  }, [theme, themeReady])

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeContext.Provider value={{ theme, setTheme }}>
        {children}
      </ThemeContext.Provider>
    </QueryClientProvider>
  )
}

type AuthErrorLike = { name?: string; code?: string; status?: number } | null | undefined

/** Miroir de la classification serveur : session définitivement invalide ≠ panne. */
function isDefinitiveUnauthenticated(error: AuthErrorLike): boolean {
  if (!error) return false
  if (error.name === 'AuthSessionMissingError' || error.code === 'session_not_found') return true
  if (error.name === 'AuthInvalidJwtError' || error.code === 'invalid_jwt' || error.code === 'bad_jwt') return true
  if (
    error.code === 'session_expired' ||
    error.code === 'refresh_token_not_found' ||
    error.code === 'refresh_token_already_used' ||
    error.code === 'user_not_found'
  ) return true
  return false
}

/**
 * Frontière privée : un `QueryClient` NEUF par (utilisateur, session) — changer
 * de compte ou ouvrir une nouvelle session abandonne l'ancien cache, aucune
 * donnée de A n'est réutilisable par B (même pour un magasin partagé).
 *
 * Le contexte magasins est hydraté avec l'instantané préparé par le serveur :
 * aucune lecture initiale des appartenances n'est nécessaire au premier rendu.
 */
function PrivateApp({ bootstrap, children }: { bootstrap: AppBootstrap; children: React.ReactNode }) {
  // Période d'ouverture du Dashboard (« Aujourd'hui ») appliquée dès le premier
  // rendu : sans cela, la période globale démarre sur `month` et une lecture
  // mensuelle peut partir avant que le filtre n'applique son défaut. Les autres
  // pages conservent le défaut historique (`month`) : la valeur n'est fournie
  // que sur la route du Dashboard.
  const pathname = usePathname()
  const initialSelectedPeriod = pathname === '/dashboard' ? 'today' : undefined

  // Toute écriture réussie périme les agrégats du dashboard : sans cette
  // invalidation centralisée, le `staleTime` analytique de 60 s laisserait des
  // chiffres périmés après une commande, une dépense, une livraison ou une
  // modification de produit.
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      mutationCache: new MutationCache({
        onSuccess: () => {
          invalidateDashboardAnalytics(client)
        },
      }),
    })
    return client
  })

  // Au démontage (changement d'identité), annuler les requêtes en vol et vider
  // le cache privé : aucune réponse ni effet de bord tardif de A ne survit.
  useEffect(() => {
    return () => {
      queryClient.cancelQueries()
      queryClient.clear()
    }
  }, [queryClient])

  return (
    <QueryClientProvider client={queryClient}>
      <StoreProvider
        initialUserId={bootstrap.userId}
        initialAuthReady
        initialBootstrap={bootstrap}
        initialSelectedPeriod={initialSelectedPeriod}
      >
        <ThemeLoader />
        {children}
      </StoreProvider>
    </QueryClientProvider>
  )
}

/** Marqueur de sécurité empêchant une boucle de rechargement de frontière. */
const BOOTSTRAP_RELOAD_MARKER = 'jisra:bootstrap-reload'

/**
 * Durée maximale d'attente d'une vérification d'identité de secours : au-delà, aucune
 * identité n'est déduite — l'espace privé reste masqué et une indisponibilité
 * réessayable est affichée (les anciennes données ne sont jamais réaffichées).
 */
const IDENTITY_RESCUE_TIMEOUT_MS = 8_000

function clearBootstrapReloadMarker() {
  try {
    window.sessionStorage.removeItem(BOOTSTRAP_RELOAD_MARKER)
  } catch {
    // Stockage indisponible : le rechargement reste possible, sans marqueur.
  }
}

/**
 * Purge la préférence de magasin persistée (nouveau format et miroirs hérités)
 * lors d'un changement d'identité : le compte suivant ne doit jamais hériter de
 * la sélection du précédent, même pour un magasin partagé.
 */
function clearPersistedSelection() {
  try {
    localStorage.removeItem(STORE_PREFERENCE_STORAGE_KEY)
    localStorage.removeItem(LEGACY_STORE_COOKIE)
  } catch {
    // Stockage indisponible : la préférence restante sera revalidée côté serveur.
  }
  document.cookie = `${STORE_PREFERENCE_COOKIE}=; path=/; max-age=0`
  document.cookie = `${LEGACY_STORE_COOKIE}=; path=/; max-age=0`
}

/**
 * Contexte applicatif réservé à l'espace protégé : magasins accessibles et
 * préférence de thème issue du profil utilisateur. Monté uniquement dans le
 * layout protégé afin que les pages publiques (homepage, login) s'affichent
 * immédiatement, sans attendre l'initialisation des magasins ni aucune
 * lecture Supabase (store_members, stores, profiles).
 */
export function AppProviders({
  initialBootstrap,
  children,
}: {
  initialBootstrap: AppBootstrap
  children: React.ReactNode
}) {
  const supabase = useMemo(() => createClient(), [])

  // Le serveur a déjà vérifié l'identité et préparé les accès : la frontière
  // privée peut être montée au premier rendu, sans attendre `INITIAL_SESSION`.
  const bootstrapReady = initialBootstrap.status === 'ready' && Boolean(initialBootstrap.sessionKey)
  // Valeurs primitives de la frontière : l'abonnement Auth doit toujours comparer
  // les événements à la DERNIÈRE frontière servie par le serveur, sans réinstaller
  // l'écouteur au moindre changement d'objet props (liste de magasins).
  const bootstrapUserId = initialBootstrap.userId
  const bootstrapSessionKey = initialBootstrap.sessionKey

  const [auth, setAuth] = useState<
    | { status: 'init' }
    | { status: 'connected'; userId: string; sessionKey: string }
    | { status: 'disconnected' }
    | { status: 'unavailable' }
  >(() =>
    bootstrapReady
      ? { status: 'connected', userId: initialBootstrap.userId, sessionKey: initialBootstrap.sessionKey }
      : { status: 'unavailable' },
  )
  const [retryKey, setRetryKey] = useState(0)
  // `true` pendant la vérification de secours déclenchée par un `INITIAL_SESSION`
  // sans session : l'identité n'est pas tranchée, donc aucun contenu privé n'est
  // affiché pendant ce contrôle (jamais de données d'une identité devenue ambiguë).
  const [identityPending, setIdentityPending] = useState(false)
  // `true` quand l'identité observée par le navigateur ne correspond plus au
  // bootstrap rendu par le serveur : le sous-arbre privé appartient à l'ancienne
  // frontière et doit être reconstruit par le serveur.
  const [needsServerBootstrap, setNeedsServerBootstrap] = useState(false)
  const currentUserIdRef = useRef<string | null>(bootstrapReady ? initialBootstrap.userId : null)
  // Génération monotone d'identité : invalidée à chaque événement Auth et au
  // démontage. Une réponse Auth asynchrone (ex. getSession du repli initial)
  // n'est appliquée que si elle est encore de la génération courante.
  const authGenerationRef = useRef(0)
  // Timer de la vérification de secours d'identité, associé à SA génération : une
  // ancienne vérification ne doit jamais annuler le timer d'une vérification plus
  // récente. Il est aussi annulé dès que l'identité est tranchée, ou au démontage.
  const identityRescueTimerRef = useRef<{
    id: ReturnType<typeof setTimeout>
    generation: number
  } | null>(null)

  /**
   * Annule le timer de secours. Sans `generation`, annule le timer courant ; avec
   * une génération, uniquement si le timer appartient encore à cette génération.
   */
  const clearIdentityRescueTimer = (generation?: number) => {
    const current = identityRescueTimerRef.current
    if (current === null) return
    if (typeof generation === 'number' && current.generation !== generation) return
    clearTimeout(current.id)
    identityRescueTimerRef.current = null
  }

  /**
   * Applique une identité décidée (serveur ou navigateur) : invalide les réponses
   * asynchrones en vol, purge la préférence du compte quitté, puis positionne
   * l'état d'interface correspondant. Elle est appelée par l'écoute Auth, mais aussi
   * par la vérification de secours qui s'exécute HORS de ce callback.
   */
  const applyIdentity = (nextUserId: string | null, nextSessionKey?: string | null) => {
    // Tout événement Auth plus récent invalide les réponses asynchrones en vol.
    authGenerationRef.current += 1
    // Une identité vient d'être tranchée : la vérification de secours et son timer
    // n'ont plus d'objet, même si sa réponse arrive ensuite.
    clearIdentityRescueTimer()
    setIdentityPending(false)
    const previous = currentUserIdRef.current
    currentUserIdRef.current = nextUserId

    // On quitte un compte (déconnexion ou changement A → B) : purger la sélection
    // persistée AVANT le prochain rendu, pour que le compte suivant ne la réutilise
    // jamais. Le cache privé est abandonné par le démontage du QueryClient de
    // PrivateApp (remonté via sa clé).
    if (previous !== null && previous !== nextUserId) {
      if (typeof window !== 'undefined') {
        clearPersistedSelection()
      }
    }

    // Sans `session_id` exploitable, ne jamais présenter un compte comme connecté :
    // deux sessions non identifiables du même compte partageraient la même frontière
    // de cache. On reste « indisponible » (avec réessai), sans fausse déconnexion.
    if (nextUserId && !nextSessionKey) {
      setAuth({ status: 'unavailable' })
      return
    }

    if (!nextUserId) {
      setAuth({ status: 'disconnected' })
      return
    }

    // Le sous-arbre rendu appartient à la frontière du bootstrap serveur : si le
    // navigateur observe une AUTRE identité ou une AUTRE session, il faut masquer
    // l'ancien arbre et faire reconstruire le contexte par le serveur (jamais
    // réafficher le bootstrap de A sous B).
    const sameBoundary =
      bootstrapReady &&
      nextUserId === bootstrapUserId &&
      nextSessionKey === bootstrapSessionKey

    if (!sameBoundary) {
      setAuth({ status: 'connected', userId: nextUserId, sessionKey: nextSessionKey ?? '' })
      setNeedsServerBootstrap(true)
      return
    }

    setNeedsServerBootstrap(false)
    setAuth((current) =>
      current.status === 'connected' &&
      current.userId === nextUserId &&
      current.sessionKey === nextSessionKey
        ? current
        : { status: 'connected', userId: nextUserId, sessionKey: nextSessionKey ?? '' },
    )
  }

  // Référence lue par la vérification de secours (effet séparé) : elle pointe
  // toujours sur l'application d'identité en vigueur.
  const applyIdentityRef = useRef(applyIdentity)
  // Mise à jour APRÈS le rendu (jamais pendant) : le rendu reste pur, et la
  // vérification de secours lit toujours la dernière identité appliquée.
  useEffect(() => {
    applyIdentityRef.current = applyIdentity
  })

  // Demande de vérification d'identité de secours : elle est POSÉE par l'écoute
  // Auth mais EXÉCUTÉE par un effet dédié, hors du callback du SDK. Rappeler une
  // méthode Auth depuis ce callback risque un blocage sur son verrou interne.
  const [rescueNonce, setRescueNonce] = useState(0)

  // Une autre frontière d'identité a été détectée : masquer immédiatement
  // l'ancien arbre et redemander une vérification serveur. Aucun état privé de A
  // ne doit être réutilisé sous B (ni l'inverse).
  useEffect(() => {
    if (!needsServerBootstrap || typeof window === 'undefined') return
    const target = `${auth.status === 'connected' ? auth.userId : 'anon'}:${
      auth.status === 'connected' ? auth.sessionKey : ''
    }`
    try {
      // Marqueur de boucle : un second échec reste affiché avec réessai manuel.
      if (window.sessionStorage.getItem(BOOTSTRAP_RELOAD_MARKER) === target) return
      window.sessionStorage.setItem(BOOTSTRAP_RELOAD_MARKER, target)
    } catch {
      // Stockage indisponible : le rechargement unique reste accepté.
    }
    // Rechargement complet : le serveur reconstruit une frontière vérifiée pour
    // la nouvelle identité. `router.refresh()` ne suffirait pas (les props du
    // layout changeraient sans repartir d'un état client propre).
    window.location.reload()
  }, [needsServerBootstrap, auth])

  useEffect(() => {
    let active = true

    // Source unique d'identité d'UI : l'événement `INITIAL_SESSION` fournit la
    // session initiale, puis les événements suivants la mettent à jour. Cette
    // identité n'autorise RIEN : la RLS et les gardes serveur restent seules à
    // décider de l'accès aux données.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return

      // `INITIAL_SESSION` avec session null peut résulter d'une panne de lecture
      // ou de renouvellement (pas d'une vraie déconnexion) : revérifier la session
      // locale et distinguer panne / absence réelle.
      if (event === 'INITIAL_SESSION' && !session) {
        const generation = authGenerationRef.current
        // L'identité n'est pas tranchée (panne de lecture ou renouvellement) : le
        // contenu privé est masqué pendant la vérification de secours. Si cette
        // vérification ne répond pas, on n'en déduit AUCUNE identité : l'espace
        // privé n'est jamais réaffiché sans confirmation (indisponibilité
        // réessayable, jamais les anciennes données).
        setIdentityPending(true)
        clearIdentityRescueTimer()
        identityRescueTimerRef.current = {
          generation,
          id: setTimeout(() => {
            identityRescueTimerRef.current = null
            if (!active || generation !== authGenerationRef.current) return
            // Vérification abandonnée : sa réponse tardive ne doit plus trancher.
            authGenerationRef.current += 1
            setIdentityPending(false)
            setAuth({ status: 'unavailable' })
          }, IDENTITY_RESCUE_TIMEOUT_MS),
        }
        // La vérification est DEMANDÉE ici, mais exécutée par un effet dédié hors
        // de ce callback : rappeler une méthode Auth depuis le callback du SDK
        // risque un blocage sur son verrou interne.
        setRescueNonce((nonce) => nonce + 1)
        return
      }

      applyIdentity(session?.user?.id ?? null, readSessionKey(session?.access_token))
    })

    return () => {
      active = false
      // Invalider les réponses asynchrones en vol au démontage/réessai.
      authGenerationRef.current += 1
      clearIdentityRescueTimer()
      subscription.unsubscribe()
    }
  }, [supabase, retryKey, bootstrapReady, bootstrapUserId, bootstrapSessionKey])

  // Vérification d'identité de secours exécutée HORS du callback Auth : bornée par
  // le timer posé au moment de la demande, nettoyée au démontage et protégée contre
  // les réponses tardives (génération). Aucune identité n'est déduite si elle ne
  // répond pas à temps : l'espace privé reste masqué et un réessai est proposé.
  const handledRescueNonceRef = useRef(0)
  useEffect(() => {
    if (rescueNonce === 0) return
    // Une même demande n'est exécutée qu'une fois (un changement de dépendance ne
    // doit pas relancer la vérification).
    if (handledRescueNonceRef.current === rescueNonce) return
    handledRescueNonceRef.current = rescueNonce

    let active = true
    const generation = authGenerationRef.current

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        // Réponse obsolète : ignorée AVANT de toucher au timer, pour ne jamais
        // annuler la vérification d'une génération plus récente.
        if (!active || generation !== authGenerationRef.current) return
        clearIdentityRescueTimer(generation)
        if (data.session?.user?.id) {
          applyIdentityRef.current(data.session.user.id, readSessionKey(data.session.access_token))
        } else if (error && !isDefinitiveUnauthenticated(error)) {
          setIdentityPending(false)
          setAuth({ status: 'unavailable' })
        } else {
          applyIdentityRef.current(null)
        }
      })
      .catch(() => {
        if (!active || generation !== authGenerationRef.current) return
        clearIdentityRescueTimer(generation)
        setIdentityPending(false)
        setAuth({ status: 'unavailable' })
      })

    return () => {
      active = false
    }
  }, [rescueNonce, supabase])

  // Aucun contenu privé tant que l'identité initiale n'est pas connue, ni pendant
  // une vérification de secours : l'arbre privé n'est rendu qu'une fois l'identité
  // tranchée.
  if (auth.status === 'init' || identityPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  // Déconnecté : ne jamais rendre l'espace privé.
  if (auth.status === 'disconnected') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="mx-auto w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-lg">
          <h1 className="text-lg font-semibold">Session terminée</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Votre session a expiré ou vous avez été déconnecté.
          </p>
          <a
            href="/login"
            className="mt-5 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Se reconnecter
          </a>
        </div>
      </div>
    )
  }

  // Indisponible : jamais l'espace privé. Deux causes distinctes, jamais
  // confondues avec « aucun magasin » :
  //  - le serveur n'a pas pu préparer le contexte (session non corrélée ou
  //    lecture des accès en échec) → un réessai passe par le serveur ;
  //  - un événement Auth navigateur n'a pas pu être tranché (panne) → on
  //    réabonne la surveillance Auth sans quitter l'identité connue.
  if (auth.status === 'unavailable') {
    const bootstrapFailure = !bootstrapReady && initialBootstrap.status === 'unavailable'
    const storesFailed =
      bootstrapFailure && initialBootstrap.errorCode === STORE_ACCESS_UNAVAILABLE

    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="mx-auto w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-lg">
          <h1 className="text-lg font-semibold">
            {storesFailed
              ? 'Impossible de charger vos magasins'
              : 'Service d\u2019authentification indisponible'}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {storesFailed
              ? 'Une erreur est survenue lors de la lecture de vos accès. Vos données n\u2019ont pas été perdues.'
              : 'Impossible de vérifier votre session pour le moment.'}
          </p>
          <button
            type="button"
            onClick={() => {
              if (bootstrapFailure) {
                clearBootstrapReloadMarker()
                window.location.reload()
                return
              }
              setRetryKey((key) => key + 1)
            }}
            className="mt-5 inline-block rounded-xl bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
          >
            Réessayer
          </button>
        </div>
      </div>
    )
  }

  // Remonter le sous-arbre privé (et son cache) à chaque identité. La
  // revalidation des droits/appartenances d'un même compte repose sur le
  // refetch au focus de fenêtre (défaut React Query) et les invalidations
  // explicites après CRUD de store — aucun événement Auth n'est prétendu
  // signaler une révocation.
  // La frontière privée est remontée à chaque (utilisateur, session) distinct.
  // `session_id` est stable pendant les renouvellements de jeton (même session),
  // mais change à chaque nouvelle connexion : une nouvelle session du même
  // compte abandonne le cache précédent sans que le renouvellement périodique
  // ne le vide.
  // Garde de frontière : l'arbre privé n'est rendu que lorsque l'identité observée
  // par le navigateur est EXACTEMENT celle du bootstrap serveur. Un changement de
  // compte ou de session en cours de reconstruction ne doit JAMAIS remonter
  // l'ancien arbre (données, magasins et rôles de A) sous la nouvelle identité :
  // on affiche un état d'attente explicite avec réessai manuel.
  const boundaryMatches =
    bootstrapReady &&
    auth.userId === bootstrapUserId &&
    auth.sessionKey === bootstrapSessionKey

  if (!boundaryMatches) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="mx-auto w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-lg">
          <h1 className="text-lg font-semibold">Reconstruction de votre espace</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Une identité différente a été détectée. Votre espace sécurisé est
            reconstruit pour ce compte.
          </p>
          <button
            type="button"
            onClick={() => {
              clearBootstrapReloadMarker()
              window.location.reload()
            }}
            className="mt-5 inline-block rounded-xl bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
          >
            Recharger
          </button>
        </div>
      </div>
    )
  }

  return (
    <PrivateApp key={`${auth.userId}:${auth.sessionKey}`} bootstrap={initialBootstrap}>
      {children}
    </PrivateApp>
  )
}
