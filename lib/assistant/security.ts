import { createClient } from '@/lib/supabase/server'

function normalizeOrigin(value: string | null | undefined) {
  if (!value) return null

  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

export function getAllowedRequestOrigins(request: Request) {
  const allowed = new Set<string>()
  const requestOrigin = normalizeOrigin(request.url)
  const configuredOrigins = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.SITE_URL,
    'https://jisra.app',
  ]

  if (requestOrigin) allowed.add(requestOrigin)

  for (const origin of configuredOrigins) {
    const normalized = normalizeOrigin(origin)
    if (normalized) allowed.add(normalized)
  }

  return allowed
}

export function assertTrustedOrigin(request: Request) {
  const originHeader = request.headers.get('origin')
  const refererHeader = request.headers.get('referer')
  const candidateOrigin = normalizeOrigin(originHeader) || normalizeOrigin(refererHeader)

  // Certains appels serveur-à-serveur / scripts non browser n'envoient pas Origin/Referer.
  if (!candidateOrigin) return

  const allowedOrigins = getAllowedRequestOrigins(request)
  if (!allowedOrigins.has(candidateOrigin)) {
    throw new Error('FORBIDDEN_ORIGIN')
  }
}

export function sanitizeInternalRedirectPath(rawPath: string | null | undefined, fallback = '/dashboard') {
  const value = String(rawPath || '').trim()
  if (!value) return fallback
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//')) return fallback
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) return fallback
  if (value.includes('\\')) return fallback
  return value
}

export async function requireAuthenticatedUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('UNAUTHORIZED')
  }

  return { supabase, user }
}

export async function verifyStoreAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  storeId: string
) {
  const { data, error } = await supabase
    .from('store_members')
    .select('id, role')
    .eq('user_id', userId)
    .eq('store_id', storeId)
    .maybeSingle()

  if (error) {
    throw new Error('STORE_ACCESS_CHECK_FAILED')
  }

  if (!data) {
    throw new Error('FORBIDDEN_STORE')
  }

  return data
}

export async function getAccessibleStoreIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
) {
  const { data, error } = await supabase
    .from('store_members')
    .select('store_id')
    .eq('user_id', userId)

  if (error) {
    throw new Error('STORE_ACCESS_CHECK_FAILED')
  }

  return (data || []).map((row) => row.store_id)
}

export function getErrorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'

  if (message === 'UNAUTHORIZED') return 401
  if (message === 'FORBIDDEN_STORE') return 403
  if (message === 'FORBIDDEN_ORIGIN') return 403
  if (message === 'NO_ACCESSIBLE_STORE') return 403
  if (message === 'NO_STORE_SELECTED') return 400
  if (message === 'EMPTY_MESSAGE') return 400
  if (message === 'INSUFFICIENT_CREDITS') return 402

  return 500
}
