export const META_CONSENT_COOKIE = 'jisra-meta-consent-v1'
export const META_CONSENT_EVENT = 'jisra:meta-consent'
export const META_PIXEL_ID = /^\d{5,25}$/.test(process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '')
  ? process.env.NEXT_PUBLIC_META_PIXEL_ID! : ''

export function metaEnabled() {
  return Boolean(META_PIXEL_ID) && process.env.NEXT_PUBLIC_JISRA_QUALIFICATION !== '1'
}

const publicPaths = new Set([
  '/', '/pricing', '/features', '/catalogue-integrations', '/about', '/contact', '/faq',
  '/features/ventes', '/features/publicite', '/features/livraison', '/features/stock', '/features/assistant-ia', '/features/multi-stores',
  '/legal/confidentialite', '/legal/conditions', '/legal/mentions', '/legal/suppression-des-donnees',
  '/login', '/signup', '/subscribe',
])

export function metaPage(path: string) {
  return publicPaths.has(path) ? path : null
}

export function metaViewContent(path: string) {
  return path === '/pricing' || (path === '/features' || (publicPaths.has(path) && path.startsWith('/features/'))) || path === '/catalogue-integrations'
}

export type MetaEvent = 'PageView' | 'ViewContent' | 'CompleteRegistration' | 'InitiateCheckout' | 'Subscribe'