'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, createContext, useContext, useEffect } from 'react'
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
        <StoreProvider>
          <ThemeLoader />
          {children}
        </StoreProvider>
      </ThemeContext.Provider>
    </QueryClientProvider>
  )
}
