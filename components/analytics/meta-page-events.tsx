'use client'

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { recordAcquisitionTouch } from '@/lib/acquisition/browser'
import { metaChoice, sendPixel, subscribeMetaChoice, syncPixelConsent } from '@/lib/analytics/meta-browser'
import { metaPage, metaViewContent } from '@/lib/analytics/meta-config'

let lastPath: string | null = null
let recorded = false

export function MetaPageEvents() {
  const pathname = usePathname()
  const query = useSearchParams()
  useEffect(() => {
    const visit = () => {
      void recordAcquisitionTouch()
      if (lastPath !== pathname) { lastPath = pathname; recorded = false }
      syncPixelConsent()
      const path = metaPage(pathname)
      if (!path || recorded || metaChoice() !== 'granted') return
      recorded = true
      const pageId = crypto.randomUUID()
      const contentId = metaViewContent(path) ? crypto.randomUUID() : undefined
      void fetch('/api/analytics/meta/page', {
        method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, pageId, contentId }),
      }).then((response) => {
        if (response.status !== 200 || location.pathname !== pathname) return
        sendPixel('PageView', pageId)
        if (contentId) sendPixel('ViewContent', contentId)
      }).catch(() => null)
    }
    visit()
    return subscribeMetaChoice(visit)
  }, [pathname, query])
  return null
}