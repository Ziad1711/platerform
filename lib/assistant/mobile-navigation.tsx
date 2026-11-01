'use client'

import { createContext, useContext } from 'react'

export type MobilePanel = 'navigation' | 'conversations' | null

export const MobileNavigationContext = createContext<{
  panel: MobilePanel
  setPanel: (panel: MobilePanel) => void
}>({ panel: null, setPanel: () => {} })

export function useMobileNavigation() {
  return useContext(MobileNavigationContext)
}