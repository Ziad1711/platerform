'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, createContext, useContext, useEffect, useMemo, useRef } from 'react'
import { StoreProvider, useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'

type Theme = 'light' | 'dark' | 'system'

const isThemeValue = (value: string | null): value is Theme => value === 'light' || value === 'dark' || value === 'system'
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
  const supabase = createClient()
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

      if (isActive && profile?.theme_preference && isThemeValue(profile.theme_preference)) {
        setTheme(profile.theme_preference)
      }
    }

    loadThemeFromProfile()

    return () => {
      isActive = false
    }
  }, [authReady, userId, supabase, setTheme])

  return null
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  const [theme, setTheme] = useState<Theme>('system')

  // Initial load from localStorage for speed
  useEffect(() => {
    const storedTheme = localStorage.getItem('theme')
    if (isThemeValue(storedTheme)) {
      setTheme(storedTheme)
    }
  }, [])

  // Apply theme to DOM
  useEffect(() => {
    localStorage.setItem('theme', theme)
    const htmlElement = document.documentElement
    const appliedTheme = resolveTheme(theme)
    if (appliedTheme === 'dark') {
      htmlElement.classList.add('dark')
      htmlElement.style.colorScheme = 'dark'
    } else {
      htmlElement.classList.remove('dark')
      htmlElement.style.colorScheme = 'light'
    }
  }, [theme])

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeContext.Provider value={{ theme, setTheme }}>
        {children}
      </ThemeContext.Provider>
    </QueryClientProvider>
  )
}

function PrivateApp({ userId, children }: { userId: string; children: React.ReactNode }) {
  // Un QueryClient NEUF par identité : changer de compte détruit l'ancien cache,
  // aucune donnée de A n'est réutilisable par B (même pour un magasin partagé),
  // et les requêtes obsolètes de l'ancien client n'ont plus d'observateur.
  const [queryClient] = useState(() => new QueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      <StoreProvider initialUserId={userId} initialAuthReady>
        <ThemeLoader />
        {children}
      </StoreProvider>
    </QueryClientProvider>
  )
}

/**
 * Contexte applicatif réservé à l'espace protégé : magasins accessibles et
 * préférence de thème issue du profil utilisateur. Monté uniquement dans le
 * layout protégé afin que les pages publiques (homepage, login) s'affichent
 * immédiatement, sans attendre l'initialisation des magasins ni aucune
 * lecture Supabase (store_members, stores, profiles).
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), [])
  const [auth, setAuth] = useState<{ userId: string | null; ready: boolean }>({
    userId: null,
    ready: false,
  })
  const currentUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    let eventSeen = false

    const handleIdentity = (nextUserId: string | null) => {
      const previous = currentUserIdRef.current
      currentUserIdRef.current = nextUserId

      // On quitte un compte (déconnexion ou changement A → B) : purger la
      // sélection persistée AVANT le prochain rendu, pour que le compte suivant
      // ne la réutilise jamais. Le cache privé est abandonné par la destruction
      // du QueryClient de PrivateApp (remonté via key ci-dessous).
      if (previous !== null && previous !== nextUserId) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('current-store-id')
          document.cookie = 'current-store-id=; path=/; max-age=0'
        }
      }

      setAuth({ userId: nextUserId, ready: true })
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      eventSeen = true
      if (!active) return
      handleIdentity(session?.user?.id ?? null)
    })

    // Résolution initiale : ignorée si un événement Auth est déjà survenu
    // (réponse asynchrone obsolète après un changement de compte inter-onglet).
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!active || eventSeen) return
        if (data.user) {
          handleIdentity(data.user.id)
          return
        }
        // Pas d'utilisateur vérifié : relire la session locale (identité d'UI
        // uniquement, la RLS garde les données) pour ne pas afficher « déconnecté »
        // sur une erreur réseau temporaire.
        supabase.auth
          .getSession()
          .then(({ data: sessionData }) => {
            if (!active || eventSeen) return
            handleIdentity(sessionData.session?.user?.id ?? null)
          })
          .catch(() => {
            // lecture impossible : l'identité reste pilotée par les événements Auth
          })
      })
      .catch(() => {
        // lecture impossible : l'identité reste pilotée par les événements Auth
      })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [supabase])

  // Aucun contenu privé tant que l'identité n'est pas résolue.
  if (!auth.ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  // Déconnecté (ou identité non vérifiée) : ne jamais rendre l'espace privé.
  if (!auth.userId) {
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

  // Remonter le sous-arbre privé (et son cache) à chaque identité.
  return (
    <PrivateApp key={auth.userId} userId={auth.userId}>
      {children}
    </PrivateApp>
  )
}
