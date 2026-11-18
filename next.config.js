/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.JISRA_Q4_RUNNER === '1' ? { distDir: '.next-q4' } : {}),
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.youcan.shop',
      },
      {
        protocol: 'https',
        hostname: 'jisra.io',
      },
    ],
  },
  async headers() {
    return [
      ...['/admin/:path*', '/api/admin/:path*'].map((source) => ({
        source,
        headers: [
          { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      })),
      {
        source: '/admin/marketing/acquisition',
        // A native same-origin POST submits Origin: null under no-referrer.
        // Keep the strict Origin guard and still suppress referrers to Meta.
        headers: [{ key: 'Referrer-Policy', value: 'same-origin' }],
      },
      ...(process.env.JISRA_Q4_RUNNER === '1' ? [{
        source: '/:path*',
        headers: [{ key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://supabase-qualif.jisra.io:8443; connect-src 'self' https://supabase-qualif.jisra.io:8443; font-src 'self' data:; media-src 'self' blob:; frame-src 'none'" }],
      }] : []),
      {
        source: '/manifest.json',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        ],
      },
      {
        source: '/icons/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        ],
      },
      {
        source: '/marketing/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
