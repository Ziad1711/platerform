'use client'

import { META_CONSENT_COOKIE, META_CONSENT_EVENT, META_PIXEL_ID, metaEnabled, metaPage, type MetaEvent } from './meta-config'

type Pixel = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void
  queue: unknown[][]
  push: Pixel
  loaded: boolean
  version: string
  disablePushState: boolean
}
const pixelWindow = () => window as Window & { fbq?: Pixel; _fbq?: Pixel }
const choiceKey = 'jisra-meta-choice-sync-v1'
let stopping = false
let ownsPixel = false
const sent = new Set<string>()

export function browserCookie(name: string) {
  return document.cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ?? ''
}

export function metaChoice() {
  if (typeof document === 'undefined') return null
  const value = browserCookie(META_CONSENT_COOKIE)
  return stopping || value === 'denied' ? 'denied' : /^[0-9a-f-]{36}$/.test(value) ? 'granted' : null
}

export function syncPixelConsent() {
  if (!ownsPixel) return
  const pixel = pixelWindow().fbq
  if (metaChoice() === 'granted' && pixelSafeLocation()) return
  if (pixel && !pixel.callMethod) pixel.queue = pixel.queue.filter(([command]) => command !== 'trackSingle')
  pixel?.('consent', 'revoke')
  if (metaChoice() === 'granted') return
  for (const name of ['_fbp', '_fbc']) {
    document.cookie = `${name}=; Path=/; Max-Age=0`
    const hostname = location.hostname
    document.cookie = `${name}=; Path=/; Domain=${hostname}; Max-Age=0`
    if (hostname.endsWith('.jisra.io')) document.cookie = `${name}=; Path=/; Domain=jisra.io; Max-Age=0`
  }
}

export function subscribeMetaChoice(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key !== choiceKey) return
    stopping = event.newValue === 'stop'
    listener()
  }
  window.addEventListener(META_CONSENT_EVENT, listener)
  window.addEventListener('storage', storage)
  return () => {
    window.removeEventListener(META_CONSENT_EVENT, listener)
    window.removeEventListener('storage', storage)
  }
}

function publishChoice(value: string) {
  try { localStorage.setItem(choiceKey, value) } catch { /* cookie remains authoritative */ }
  window.dispatchEvent(new Event(META_CONSENT_EVENT))
}

export async function setMetaChoice(granted: boolean) {
  if (!granted) {
    stopping = true
    publishChoice('stop')
    syncPixelConsent()
  }
  const response = await fetch('/api/analytics/meta/consent', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ granted }),
  })
  if (!response.ok) throw new Error('META_CONSENT_NOT_SAVED')
  stopping = false
  publishChoice(crypto.randomUUID())
}

function safePixelUrl(url: URL | Location) {
  if (!metaPage(url.pathname) || url.hash) return false
  if (!url.search) return true
  const entries = [...new URLSearchParams(url.search)]
  if (url.pathname === '/subscribe') return entries.length <= 3 && entries.every(([key, value]) =>
    (key === 'plan' && /^(free|pro|ultimate)$/.test(value)) ||
    (key === 'period' && /^(monthly|yearly)$/.test(value)) ||
    (key === 'price' && /^[a-f0-9-]{36}$/.test(value)))
  return entries.length === 1 && entries[0][0] === 'fbclid' && /^[a-zA-Z0-9_-]{1,250}$/.test(entries[0][1])
}

function pixelSafeLocation() {
  if (!safePixelUrl(location)) return false
  if (!document.referrer) return true
  try {
    const referrer = new URL(document.referrer)
    return referrer.origin === location.origin ? safePixelUrl(referrer) : referrer.pathname === '/' && !referrer.search && !referrer.hash
  }
  catch { return false }
}

export function sendPixel(event: MetaEvent, id: string) {
  if (!metaEnabled() || metaChoice() !== 'granted' || !pixelSafeLocation() || sent.has(id)) return
  const win = pixelWindow()
  if (!ownsPixel) {
    if (win.fbq) return // Do not share a queue or override an unrelated integration.
    const pixel = ((...args: unknown[]) => {
      if (pixel.callMethod) pixel.callMethod(...args)
      else pixel.queue.push(args)
    }) as Pixel
    pixel.push = pixel
    pixel.loaded = true
    pixel.version = '2.0'
    pixel.queue = []
    pixel.disablePushState = true
    win.fbq = win._fbq = pixel
    ownsPixel = true
    pixel('consent', 'grant')
    pixel('set', 'autoConfig', false, META_PIXEL_ID)
    pixel('init', META_PIXEL_ID)
    const script = document.createElement('script')
    script.async = true
    script.referrerPolicy = 'no-referrer'
    script.src = 'https://connect.facebook.net/en_US/fbevents.js'
    document.head.appendChild(script)
  }
  if (!win.fbq) return
  sent.add(id)
  win.fbq('consent', 'grant')
  win.fbq('trackSingle', META_PIXEL_ID, event, {}, { eventID: id })
}

export function metaSignup(path: '/signup' | '/login') {
  if (!metaEnabled() || metaChoice() !== 'granted') return null
  return { _jisra_meta_consent: browserCookie(META_CONSENT_COOKIE), _jisra_meta_event: crypto.randomUUID(), _jisra_meta_path: path }
}

export async function confirmMetaSignup(eventId: string | undefined, userId: string | undefined) {
  if (!eventId || !userId || metaChoice() !== 'granted' || !pixelSafeLocation()) return
  try {
    const response = await fetch('/api/analytics/meta/registration', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(1500),
      body: JSON.stringify({ eventId, userId }),
    })
    if (response.ok) sendPixel('CompleteRegistration', eventId)
  } catch { /* the committed CAPI event does not depend on the browser */ }
}