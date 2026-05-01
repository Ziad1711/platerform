import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const configuredRedirectUri = (process.env.YOUCAN_REDIRECT_URI || '').trim()

  let callbackOrigin = url.origin
  if (configuredRedirectUri) {
    try {
      callbackOrigin = new URL(configuredRedirectUri).origin
    } catch {
      callbackOrigin = url.origin
    }
  }

  const target = new URL('/api/integrations/youcan/callback', callbackOrigin)

  url.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value)
  })

  target.searchParams.set('popup', '1')

  return NextResponse.redirect(target)
}
