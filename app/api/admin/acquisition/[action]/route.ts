import { randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { adminError, assertAdminOrigin, requireAdmin } from '@/lib/admin/access.server'
import { acquisitionConfig, acquisitionPath, activateAcquisition, AcquisitionError, oauthPath } from '@/lib/acquisition/meta.server'
import { buildFacebookAdsAuthorizeUrl, createFacebookAdsOAuthState, parseFacebookAdsOAuthState } from '@/lib/integrations/facebook-ads'

export const maxDuration = 30
const cookie = '__Secure-jisra-acquisition-state'
const options = { path: oauthPath, secure: true, httpOnly: true, sameSite: 'lax' as const }
type Route = { params: Promise<{ action: string }> }

export async function POST(request: Request, { params }: Route) {
  if ((await params).action !== 'connect') return new Response(null, { status: 404 })
  try {
    assertAdminOrigin(request)
    const { supabase } = await requireAdmin('acquisition.manage')
    const { data: { user }, error } = await supabase.auth.getUser()
    if (!user || error) throw new Error('ADMIN_AUTH')
    const config = acquisitionConfig()
    if (!config || new URL(request.url).origin !== config.origin) throw new Error('ADMIN_UNAVAILABLE')
    const state = createFacebookAdsOAuthState({ userId: user.id, ts: Date.now() }, config.clientSecret + ':jisra-acquisition')
    const uniqueState = `${randomBytes(32).toString('base64url')}.${state}`
    const url = new URL(buildFacebookAdsAuthorizeUrl({ ...config, state: uniqueState, scopes: ['ads_read'] }))
    url.searchParams.set('auth_type', 'rerequest')
    const response = NextResponse.redirect(url, 303)
    response.cookies.set(cookie, uniqueState, { ...options, maxAge: 600 })
    return response
  } catch (error) { return adminError(error) }
}

export async function GET(request: Request, { params }: Route) {
  if ((await params).action !== 'callback') return new Response(null, { status: 404 })
  const config = acquisitionConfig()
  const incoming = new URL(request.url)
  if (!config || incoming.origin !== config.origin) return new Response(null, { status: 404 })
  const result = new URL(acquisitionPath, config.origin)
  let outcome = 'invalid'
  try {
    const { supabase } = await requireAdmin('acquisition.manage')
    const { data: { user }, error } = await supabase.auth.getUser()
    if (!user || error) throw new Error('ADMIN_AUTH')
    const state = incoming.searchParams.get('state') ?? ''
    const expected = (await cookies()).get(cookie)?.value ?? ''
    const a = Buffer.from(state), b = Buffer.from(expected)
    if (!a.length || a.length > 1024 || a.length !== b.length || !timingSafeEqual(a, b) ||
      parseFacebookAdsOAuthState(state.slice(state.indexOf('.') + 1), config.clientSecret + ':jisra-acquisition', 600)?.userId !== user.id) {
      throw new Error('INVALID_STATE')
    }
    const code = incoming.searchParams.get('code')
    if (!code || code.length > 4096 || incoming.searchParams.has('error')) outcome = 'denied'
    else {
      await activateAcquisition(config, code)
      outcome = 'connected'
    }
  } catch (error) {
    if (error instanceof AcquisitionError) outcome = error.code === 'ACCESS_DENIED' ? 'permission' : 'failed'
    else if (error instanceof Error && error.message.startsWith('FACEBOOK_')) outcome = 'failed'
  }
  result.searchParams.set('oauth', outcome)
  const response = NextResponse.redirect(result, 303)
  response.cookies.set(cookie, '', { ...options, maxAge: 0 })
  return response
}