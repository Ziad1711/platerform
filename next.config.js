/** @type {import('next').NextConfig} */
const supabaseHostname = (() => {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!url || typeof url !== 'string') return undefined
    return new URL(url).hostname
  } catch {
    return undefined
  }
})()

const nextConfig = {
  images: {
    remotePatterns: [
      ...(supabaseHostname
        ? [{
            protocol: 'https',
            hostname: supabaseHostname,
          }]
        : []),
      {
        protocol: 'https',
        hostname: '*.youcan.shop',
      },
      {
        protocol: 'https',
        hostname: 'platerform.vercel.app',
      },
    ],
  },
  async headers() {
    return [
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
