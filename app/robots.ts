import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/pricing', '/features', '/about', '/contact', '/legal'],
      disallow: ['/dashboard', '/sales', '/products', '/stock', '/suppliers', '/advertising', '/expenses', '/integrations', '/delivery', '/ai-assistant', '/api'],
    },
    sitemap: 'https://jisra.app/sitemap.xml',
  }
}