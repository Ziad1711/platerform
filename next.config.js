/** @type {import('next').NextConfig} */
const supabaseHostname = (() => {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    return url ? new URL(url).hostname : null
  } catch {
    return null
  }
})()

const nextConfig = {
  images: {
    remotePatterns: [
      supabaseHostname
        ? {
            protocol: 'https',
            hostname: supabaseHostname,
          }
        : null,
      {
        protocol: 'https',
        hostname: '*.youcan.shop',
      },
      {
        protocol: 'https',
        hostname: 'jisra.app',
      },
    ].filter(Boolean),
  },
}

module.exports = nextConfig