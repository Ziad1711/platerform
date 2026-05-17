'use client'

import { createContext, useContext, useMemo, useState, ReactNode, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
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

  const { data: accessibleStores = [], isLoading: isStoresLoading } = useQuery({
    queryKey: ['accessible-stores'],
    queryFn: async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError) {
        throw userError
      }

      if (!user) {
        return [] as AccessibleStore[]
      }

      const { data: memberships, error: membershipsError } = await supabase
        .from('store_members')
        .select('store_id')
        .eq('user_id', user.id)

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

  const accessibleStoreIds = accessibleStores.map((store) => store.id)

  // Auto-select immédiat : dès que les stores sont chargés et qu'aucun store n'est sélectionné
  // On utilise un useEffect séparé pour éviter le flash
  useEffect(() => {
    if (!isStoresLoading && accessibleStores.length > 0 && !currentStoreId) {
      setCurrentStoreId(accessibleStores[0].id)
    }
  }, [accessibleStores, currentStoreId, isStoresLoading])

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
