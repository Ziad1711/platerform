import type { MetadataRoute } from 'next'

const routes = [
  '',
  '/login',
  '/pricing',
  '/features',
  '/features/ventes',
  '/features/publicite',
  '/features/livraison',
  '/features/stock',
  '/features/assistant-ia',
  '/features/multi-stores',
  '/about',
  '/contact',
  '/legal/conditions',
  '/legal/confidentialite',
  '/legal/mentions',
]

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://jisra.app'

  return routes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: route === '' ? 'weekly' : 'monthly',
    priority: route === '' ? 1 : 0.7,
  }))
}