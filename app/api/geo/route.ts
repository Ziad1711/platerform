import { NextResponse } from 'next/server'

const countryDefaults: Record<string, { currency: string; timezone: string }> = {
  MA: { currency: 'MAD', timezone: 'Africa/Casablanca' },
  FR: { currency: 'EUR', timezone: 'Europe/Paris' },
  ES: { currency: 'EUR', timezone: 'Europe/Madrid' },
  US: { currency: 'USD', timezone: 'America/New_York' },
  GB: { currency: 'GBP', timezone: 'Europe/London' },
  AE: { currency: 'AED', timezone: 'Asia/Dubai' },
  CA: { currency: 'CAD', timezone: 'America/Toronto' },
}

export async function GET(request: Request) {
  const country = (request.headers.get('x-vercel-ip-country') || 'MA').toUpperCase()
  const fallback = countryDefaults[country] || countryDefaults.MA

  return NextResponse.json({
    country,
    currency: fallback.currency,
    timezone: fallback.timezone,
  })
}