import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/marketing/site-url'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/pricing', '/features', '/about', '/contact', '/legal'],
      disallow: ['/dashboard', '/sales', '/products', '/stock', '/suppliers', '/advertising', '/expenses', '/integrations', '/delivery', '/ai-assistant', '/api'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
