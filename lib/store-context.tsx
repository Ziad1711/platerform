'use client'

import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { DashboardPeriod } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

type AccessibleStore = {
  id: string
  name: string
  logo_url: string | null
}

interface StoreContextType {
  currentStoreId: string | null
  setCurrentStoreId: (storeId: string | null) => void
  accessibleStores: AccessibleStore[]
  accessibleStoreIds: string[]
  isStoresLoading: boolean
  selectedPeriod: DashboardPeriod
  setSelectedPeriod: (period: DashboardPeriod) => void
  customStartDate: string | null
  setCustomStartDate: (date: string | null) => void
  customEndDate: string | null
  setCustomEndDate: (date: string | null) => void
}

const StoreContext = createContext<StoreContextType | undefined>(undefined)

export function StoreProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()
  const [authReady, setAuthReady] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [currentStoreId, setCurrentStoreIdState] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('current-store-id')
    }
    return null
  })
  const [selectedPeriod, setSelectedPeriod] = useState<DashboardPeriod>('month')
  const [customStartDate, setCustomStartDate] = useState<string | null>(null)
  const [customEndDate, setCustomEndDate] = useState<string | null>(null)

  const setCurrentStoreId = (storeId: string | null) => {
    setCurrentStoreIdState(storeId)
    if (typeof window !== 'undefined') {
      if (storeId) {
        localStorage.setItem('current-store-id', storeId)
        document.cookie = `current-store-id=${storeId}; path=/; max-age=${60 * 60 * 24 * 365}`
      } else {
        localStorage.removeItem('current-store-id')
        document.cookie = 'current-store-id=; path=/; max-age=0'
      }
    }
  }

  useEffect(() => {
    let active = true

    const loadUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!active) return
      setUserId(user?.id ?? null)
      setAuthReady(true)
    }

    void loadUser()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user?.id ?? null
      setUserId(nextUserId)
      setAuthReady(true)
      void queryClient.invalidateQueries({ queryKey: ['accessible-stores'] })

      if (!nextUserId) {
        setCurrentStoreId(null)
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [queryClient, supabase])

  const { data: accessibleStores = [], isLoading } = useQuery({
    queryKey: ['accessible-stores', userId],
    enabled: authReady && Boolean(userId),
    queryFn: async () => {
      if (!userId) {
        return [] as AccessibleStore[]
      }

      const { data: memberships, error: membershipsError } = await supabase
        .from('store_members')
        .select('store_id')
        .eq('user_id', userId)
        .eq('status', 'active')

      if (membershipsError) {
        throw membershipsError
      }

      const storeIds = Array.from(new Set((memberships || []).map((row) => String(row.store_id || '')).filter(Boolean)))
      if (storeIds.length === 0) {
        return [] as AccessibleStore[]
      }

      const { data: stores, error: storesError } = await supabase
        .from('stores')
        .select('id, name, logo_url')
        .in('id', storeIds)
        .order('created_at', { ascending: true })

      if (storesError) {
        throw storesError
      }

      return (stores || []) as AccessibleStore[]
    },
  })

  const isStoresLoading = !authReady || (Boolean(userId) && isLoading)

  useEffect(() => {
    if (isStoresLoading) return

    if (accessibleStores.length === 0) {
      if (currentStoreId) setCurrentStoreId(null)
      return
    }

    const hasCurrentStore = currentStoreId
      ? accessibleStores.some((store) => store.id === currentStoreId)
      : false

    if (!hasCurrentStore) {
      setCurrentStoreId(accessibleStores[0].id)
    }
  }, [accessibleStores, currentStoreId, isStoresLoading])

  // Bloquer le rendu des enfants tant que les stores chargent et qu'aucun store n'est sélectionné
  // Cela évite le flash "veuillez sélectionner un store" pour les invités
  // On retourne un spinner sans rendre les enfants pour éviter que les composants dashboard
  // recoivent currentStoreId: null et accessibleStores: []
  if (isStoresLoading && !currentStoreId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  const accessibleStoreIds = accessibleStores.map((store) => store.id)

  return (
    <StoreContext.Provider
      value={{
        currentStoreId,
        setCurrentStoreId,
        accessibleStores,
        accessibleStoreIds,
        isStoresLoading,
        selectedPeriod,
        setSelectedPeriod,
        customStartDate,
        setCustomStartDate,
        customEndDate,
        setCustomEndDate,
      }}
    >
      {children}
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
