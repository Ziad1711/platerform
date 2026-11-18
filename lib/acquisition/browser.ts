'use client'

import { browserCookie, metaChoice } from '@/lib/analytics/meta-browser'
import { META_CONSENT_COOKIE, metaPage } from '@/lib/analytics/meta-config'
import { acquisitionTouch } from './touch'

let recent: { key: string; pending: Promise<boolean> } | undefined

export function recordAcquisitionTouch() {
  if (metaChoice() !== 'granted' || !metaPage(location.pathname)) {
    recent = undefined
    return
  }
  const touch = acquisitionTouch(new URLSearchParams(location.search))
  if (!touch) return
  const key = `${browserCookie(META_CONSENT_COOKIE)}:${JSON.stringify(touch)}`
  if (recent?.key === key) return recent.pending
  const prior = recent?.pending
  const pending = (async () => {
    await prior
    if (metaChoice() !== 'granted' || !key.startsWith(`${browserCookie(META_CONSENT_COOKIE)}:`)) return false
    try {
      return (await fetch('/api/analytics/acquisition', {
        method: 'POST', keepalive: true, signal: AbortSignal.timeout(1800),
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(touch),
      })).ok
    } catch { return false }
  })()
  recent = { key, pending }
  void pending.then(ok => { if (!ok && recent?.pending === pending) recent = undefined })
  return pending
}

export async function acquisitionSignup() {
  if (metaChoice() !== 'granted') return {}
  await (recordAcquisitionTouch() ?? recent?.pending)
  return metaChoice() === 'granted' ? { _jisra_acquisition_consent: browserCookie(META_CONSENT_COOKIE) } : {}
}