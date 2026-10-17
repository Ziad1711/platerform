import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/marketing/site-url'

const routes = [
  '',
  '/pricing',
  '/features',
  '/features/ventes',
  '/features/publicite',
  '/features/livraison',
  '/features/stock',
  '/features/assistant-ia',
  '/features/multi-stores',
  '/documentation',
  '/about',
  '/contact',
  '/legal/conditions',
  '/legal/confidentialite',
  '/legal/mentions',
  '/legal/suppression-des-donnees',
]

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = SITE_URL

  return routes.map((route) => ({
    url: `${baseUrl}${route}`,
    changeFrequency: route === '' ? 'weekly' : 'monthly',
    priority: route === '' ? 1 : 0.7,
  }))
}